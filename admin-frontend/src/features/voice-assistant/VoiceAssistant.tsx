import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { ordersApi } from '@/features/orders/api';
import { api } from '@/lib/axios';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type AssistantState =
  | 'idle'
  | 'listening_intent'
  | 'asking_name'
  | 'listening_name'
  | 'asking_advertiser'
  | 'listening_advertiser'
  | 'confirming'
  | 'listening_confirmation'
  | 'creating'
  | 'done'
  | 'error';

// ─── Speech helpers ──────────────────────────────────────────────────────────

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

function listen(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      reject(new Error('SpeechRecognition no soportado'));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      resolve(transcript);
    };

    recognition.onerror = (event: any) => {
      reject(new Error(event.error));
    };

    recognition.onnomatch = () => {
      reject(new Error('No se entendió'));
    };

    recognition.start();
  });
}

function isOrderIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const keywords = ['crear', 'nueva', 'nuevo', 'agregar', 'insertar', 'orden', 'pedido', 'campaña'];
  return keywords.some((kw) => lower.includes(kw));
}

function isConfirmation(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const yes = ['sí', 'si', 'correcto', 'confirmo', 'confirmar', 'ok', 'okey', 'dale', 'está bien', 'perfecto', 'adelante'];
  return yes.some((w) => lower.includes(w));
}

function isNegation(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const no = ['no', 'cancelar', 'cancela', 'incorrecto', 'mal', 'está mal'];
  return no.some((w) => lower.includes(w));
}

/**
 * Call the backend to extract the clean value from a voice transcript using OpenAI.
 * Falls back to raw transcript if the call fails.
 */
async function extractCleanValue(
  transcript: string,
  field: 'order_name' | 'advertiser_name',
  context?: string,
): Promise<string> {
  try {
    const res = await api.post<{ value: string }>('/admin/voice/extract', {
      transcript,
      field,
      context,
    });
    return res.data.value || transcript;
  } catch (err) {
    console.warn('[VoiceAssistant] extractCleanValue failed, using raw transcript:', err);
    return transcript;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VoiceAssistant() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState('');
  const [orderName, setOrderName] = useState('');
  const [advertiserName, setAdvertiserName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(false);

  const createOrder = useMutation({
    mutationFn: (data: { name: string; advertiser_name: string | null }) =>
      ordersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const reset = useCallback(() => {
    setState('idle');
    setTranscript('');
    setOrderName('');
    setAdvertiserName('');
    setErrorMsg('');
    abortRef.current = false;
  }, []);

  const close = useCallback(() => {
    abortRef.current = true;
    speechSynthesis.cancel();
    setIsOpen(false);
    reset();
  }, [reset]);

  const startFlow = useCallback(async () => {
    if (abortRef.current) return;

    try {
      // Step 1: Listen for intent
      setState('listening_intent');
      setTranscript('');
      await speak('Hola, ¿en qué puedo ayudarte el día de hoy?');
      if (abortRef.current) return;

      const intent = await listen();
      if (abortRef.current) return;
      setTranscript(intent);

      if (!isOrderIntent(intent)) {
        setState('error');
        setErrorMsg('Solo puedo ayudarte a crear pedidos por ahora.');
        await speak('Lo siento, solo puedo ayudarte a crear pedidos por ahora.');
        setTimeout(close, 2000);
        return;
      }

      // Step 2: Ask for order name
      setState('asking_name');
      await speak('Perfecto, vamos a crear un pedido. ¿Qué nombre le pongo?');
      if (abortRef.current) return;

      setState('listening_name');
      const rawName = await listen();
      if (abortRef.current) return;
      setTranscript(rawName);

      // Extract clean name using OpenAI
      const name = await extractCleanValue(rawName, 'order_name');
      setOrderName(name);

      // Step 3: Ask for advertiser
      setState('asking_advertiser');
      await speak(`Entendido, "${name}". ¿Para qué anunciante es?`);
      if (abortRef.current) return;

      setState('listening_advertiser');
      const rawAdvertiser = await listen();
      if (abortRef.current) return;
      setTranscript(rawAdvertiser);

      // Extract clean advertiser using OpenAI
      const advertiser = await extractCleanValue(
        rawAdvertiser,
        'advertiser_name',
        `El pedido se llama "${name}"`,
      );
      setAdvertiserName(advertiser);

      // Step 4: Confirm
      setState('confirming');
      await speak(
        `Voy a crear el pedido "${name}" para el anunciante "${advertiser}". ¿Es correcto?`
      );
      if (abortRef.current) return;

      setState('listening_confirmation');
      const confirmation = await listen();
      if (abortRef.current) return;
      setTranscript(confirmation);

      if (isNegation(confirmation)) {
        await speak('Entendido, cancelando.');
        close();
        return;
      }

      if (!isConfirmation(confirmation)) {
        await speak('No entendí tu respuesta. Cancelando por seguridad.');
        close();
        return;
      }

      // Step 5: Create the order (and upsert advertiser)
      setState('creating');
      await speak('Creando el pedido...');

      // Search or create the advertiser
      try {
        const searchRes = await api.get<{ data: Array<{ id: string; name: string }> }>(
          '/admin/advertisers',
          { params: { q: advertiser } },
        );
        const existing = searchRes.data.data.find(
          (a) => a.name.toLowerCase() === advertiser.toLowerCase(),
        );
        if (!existing) {
          await api.post('/admin/advertisers', { name: advertiser });
        }
      } catch {
        // Non-critical — continue with order creation regardless
      }

      const order = await createOrder.mutateAsync({
        name,
        advertiser_name: advertiser || null,
      });

      setState('done');
      await speak(`Listo. El pedido "${name}" ha sido creado exitosamente.`);

      // Navigate to orders
      setTimeout(() => {
        close();
        navigate('/orders');
      }, 1000);
    } catch (err: any) {
      if (abortRef.current) return;
      setState('error');
      const msg = err?.message ?? 'Ocurrió un error';
      setErrorMsg(msg);
      await speak('Ocurrió un error. Inténtalo de nuevo.');
      setTimeout(close, 2000);
    }
  }, [close, createOrder, navigate]);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    reset();
    // Small delay to let the UI render before starting speech
    setTimeout(() => {
      startFlow();
    }, 300);
  }, [reset, startFlow]);

  // State display text
  const stateLabel: Record<AssistantState, string> = {
    idle: 'Listo',
    listening_intent: 'Escuchando...',
    asking_name: 'Preguntando nombre...',
    listening_name: 'Escuchando nombre...',
    asking_advertiser: 'Preguntando anunciante...',
    listening_advertiser: 'Escuchando anunciante...',
    confirming: 'Confirmando...',
    listening_confirmation: 'Escuchando confirmación...',
    creating: 'Creando pedido...',
    done: '¡Creado!',
    error: 'Error',
  };

  const isListening = state.startsWith('listening');
  const isSpeaking = state === 'asking_name' || state === 'asking_advertiser' || state === 'confirming';

  return (
    <>
      {/* Floating bubble */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
          title="Asistente de voz"
        >
          <Mic className="h-6 w-6" />
        </button>
      )}

      {/* Voice modal */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl bg-white shadow-2xl border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-white">
            <span className="text-sm font-medium">Asistente de Voz</span>
            <button onClick={close} className="hover:bg-white/20 rounded p-1 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Visualizer area */}
          <div className="flex flex-col items-center justify-center py-8 px-4">
            {/* Animated circles */}
            <div className="relative flex items-center justify-center mb-4">
              <div
                className={cn(
                  'absolute h-20 w-20 rounded-full bg-primary/10 transition-all duration-500',
                  isListening && 'animate-ping'
                )}
              />
              <div
                className={cn(
                  'absolute h-14 w-14 rounded-full bg-primary/20 transition-all duration-300',
                  isListening && 'animate-pulse'
                )}
              />
              <div
                className={cn(
                  'relative flex h-12 w-12 items-center justify-center rounded-full transition-all',
                  isListening ? 'bg-red-500' : isSpeaking ? 'bg-primary' : 'bg-gray-300'
                )}
              >
                <Mic className="h-5 w-5 text-white" />
              </div>
            </div>

            {/* State label */}
            <p className="text-sm font-medium text-gray-700 mb-1">
              {stateLabel[state]}
            </p>

            {/* Transcript */}
            {transcript && (
              <p className="text-xs text-muted-foreground text-center italic max-w-full truncate">
                "{transcript}"
              </p>
            )}

            {/* Order info being built */}
            {orderName && (
              <div className="mt-3 w-full rounded-md border bg-gray-50 p-2 text-xs space-y-1">
                <p><span className="font-medium">Pedido:</span> {orderName}</p>
                {advertiserName && <p><span className="font-medium">Anunciante:</span> {advertiserName}</p>}
              </div>
            )}

            {/* Error */}
            {errorMsg && (
              <p className="mt-2 text-xs text-red-500 text-center">{errorMsg}</p>
            )}

            {/* Done */}
            {state === 'done' && (
              <p className="mt-2 text-xs text-green-600 font-medium">✓ Pedido creado</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
