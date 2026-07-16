import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { api } from '@/lib/axios';
import { Input } from '@/components/ui/input';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Advertiser {
  id: string;
  name: string;
}

interface AdvertiserAutocompleteProps {
  value: string;
  onChange: (value: string, confirmed: boolean, advertiserId?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Autocomplete for Advertisers.
 * - Typing searches existing advertisers
 * - Selecting from list confirms the advertiser (onChange with confirmed=true)
 * - "Crear" button creates the advertiser first, then confirms
 * - Enter: if exact match exists → select it; if not → create it
 * - The parent form should check `confirmed` before allowing submission
 */
export function AdvertiserAutocomplete({
  value,
  onChange,
  placeholder = 'Nombre del anunciante',
  disabled = false,
  className,
}: AdvertiserAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(!!value);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search advertisers
  const { data: suggestions } = useQuery({
    queryKey: ['advertisers', debouncedQuery],
    queryFn: () =>
      api.get<{ data: Advertiser[] }>('/admin/advertisers', { params: { q: debouncedQuery } })
        .then((r) => r.data.data),
    enabled: debouncedQuery.length >= 2,
  });

  // Create advertiser mutation
  const createMutation = useMutation({
    mutationFn: (name: string) =>
      api.post<{ data: Advertiser }>('/admin/advertisers', { name }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advertisers'] });
    },
  });

  function handleInputChange(text: string) {
    setInputValue(text);
    setIsConfirmed(false);
    onChange(text, false, undefined);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(text.trim());
      if (text.trim().length >= 2) {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    }, 300);
  }

  function handleSelect(advertiser: Advertiser) {
    setInputValue(advertiser.name);
    setIsConfirmed(true);
    onChange(advertiser.name, true, advertiser.id);
    setIsOpen(false);
  }

  function handleCreateNew() {
    const name = inputValue.trim();
    if (!name || createMutation.isPending) return;

    createMutation.mutate(name, {
      onSuccess: (created) => {
        setInputValue(created.name);
        setIsConfirmed(true);
        onChange(created.name, true, created.id);
        setIsOpen(false);
      },
    });
  }

  function handleBlur() {
    setTimeout(() => setIsOpen(false), 200);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault(); // Always prevent form submission from this input
      e.stopPropagation();

      const trimmed = inputValue.trim();
      if (!trimmed) return;

      // If there's an exact match in suggestions, select it
      const exactMatch = suggestions?.find(
        (a) => a.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (exactMatch) {
        handleSelect(exactMatch);
        return;
      }

      // If suggestions are open and there are results, select the first one
      if (isOpen && suggestions && suggestions.length > 0) {
        handleSelect(suggestions[0]);
        return;
      }

      // Otherwise, create new advertiser
      handleCreateNew();
    }
  }

  const showSuggestions = isOpen && debouncedQuery.length >= 2;
  const hasExactMatch = suggestions?.some(
    (a) => a.name.toLowerCase() === inputValue.trim().toLowerCase()
  );

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (debouncedQuery.length >= 2) setIsOpen(true);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || createMutation.isPending}
          className={cn(className, isConfirmed && 'pr-8')}
          autoComplete="off"
        />
        {isConfirmed && (
          <Check className="absolute right-2.5 top-2.5 h-4 w-4 text-green-600" />
        )}
        {createMutation.isPending && (
          <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {!isConfirmed && inputValue.trim().length >= 2 && !isOpen && (
        <p className="text-xs text-amber-600 mt-1">
          Presiona Enter para crear o selecciona de la lista
        </p>
      )}

      {showSuggestions && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-y-auto">
          {suggestions && suggestions.length > 0 ? (
            <>
              {suggestions.map((advertiser) => (
                <button
                  key={advertiser.id}
                  type="button"
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors',
                    advertiser.name.toLowerCase() === inputValue.trim().toLowerCase() && 'bg-gray-50 font-medium'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(advertiser);
                  }}
                >
                  {advertiser.name}
                </button>
              ))}
              {!hasExactMatch && inputValue.trim().length >= 2 && (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-primary/5 border-t font-medium"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleCreateNew();
                  }}
                >
                  + Crear "{inputValue.trim()}"
                </button>
              )}
            </>
          ) : (
            <div className="px-3 py-2">
              <p className="text-sm text-muted-foreground mb-1">No se encontraron resultados</p>
              {inputValue.trim().length >= 2 && (
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-left text-sm text-primary hover:bg-primary/5 rounded font-medium"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleCreateNew();
                  }}
                >
                  + Crear "{inputValue.trim()}"
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
