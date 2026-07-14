import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient } from '@/lib/query-client';
import {
  ordersApi,
  orderLinesApi,
  creativesApi,
  targetsApi,
  resolutionsApi,
  bulkCreativesApi,
  contentApi,
} from './api';
import type {
  CreateOrderInput,
  UpdateOrderInput,
  CreateOrderLineInput,
  UpdateOrderLineInput,
  CreateCreativeInput,
  UpdateCreativeInput,
  CreateTargetInput,
} from './api';
import type { BulkCreativeInput } from './types';

// ─── Orders ──────────────────────────────────────────────────────────────────

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: ordersApi.list,
  });
}

export function useDeliveryProgress(orderId: string | undefined) {
  return useQuery({
    queryKey: ['orders', orderId, 'delivery-progress'],
    queryFn: () => ordersApi.deliveryProgress(orderId!),
    enabled: !!orderId,
    refetchInterval: 30_000, // Refresh every 30s for live updates
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: () => ordersApi.get(id!),
    enabled: !!id,
  });
}

export function useCreateOrder() {
  return useMutation({
    mutationFn: (data: CreateOrderInput) => ordersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Pedido creado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al crear pedido');
    },
  });
}

export function useUpdateOrder() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateOrderInput }) => ordersApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders', variables.id] });
      toast.success('Pedido actualizado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar pedido');
    },
  });
}

export function useDeleteOrder() {
  return useMutation({
    mutationFn: (id: string) => ordersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Pedido eliminado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar pedido');
    },
  });
}

// ─── Order Lines ─────────────────────────────────────────────────────────────

export function useOrderLines(orderId: string | undefined) {
  return useQuery({
    queryKey: ['orders', orderId, 'order-lines'],
    queryFn: () => orderLinesApi.list(orderId!),
    enabled: !!orderId,
  });
}

export function useCreateOrderLine(orderId: string) {
  return useMutation({
    mutationFn: (data: CreateOrderLineInput) => orderLinesApi.create(orderId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'order-lines'] });
      queryClient.invalidateQueries({ queryKey: ['orders', orderId] });
      toast.success('Línea de pedido creada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al crear línea de pedido');
    },
  });
}

export function useUpdateOrderLine(orderId: string) {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateOrderLineInput }) => orderLinesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'order-lines'] });
      queryClient.invalidateQueries({ queryKey: ['orders', orderId] });
      toast.success('Línea de pedido actualizada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar línea de pedido');
    },
  });
}

export function useDeleteOrderLine(orderId: string) {
  return useMutation({
    mutationFn: (id: string) => orderLinesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'order-lines'] });
      queryClient.invalidateQueries({ queryKey: ['orders', orderId] });
      toast.success('Línea de pedido eliminada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar línea de pedido');
    },
  });
}

// ─── Creatives ───────────────────────────────────────────────────────────────

export function useCreatives(orderLineId: string | undefined) {
  return useQuery({
    queryKey: ['order-lines', orderLineId, 'creatives'],
    queryFn: () => creativesApi.list(orderLineId!),
    enabled: !!orderLineId,
  });
}

export function useCreateCreative(orderLineId: string) {
  return useMutation({
    mutationFn: (data: CreateCreativeInput) => creativesApi.create(orderLineId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'creatives'] });
      toast.success('Creativo agregado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al agregar creativo');
    },
  });
}

export function useUpdateCreative(orderLineId: string) {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCreativeInput }) => creativesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'creatives'] });
      toast.success('Creativo actualizado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar creativo');
    },
  });
}

export function useDeleteCreative(orderLineId: string) {
  return useMutation({
    mutationFn: (id: string) => creativesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'creatives'] });
      toast.success('Creativo eliminado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar creativo');
    },
  });
}

// ─── Targets ─────────────────────────────────────────────────────────────────

export function useTargets(orderLineId: string | undefined) {
  return useQuery({
    queryKey: ['order-lines', orderLineId, 'targets'],
    queryFn: () => orderLinesApi.get(orderLineId!).then((ol) => ol.targets ?? []),
    enabled: !!orderLineId,
  });
}

export function useCreateTarget(orderLineId: string) {
  return useMutation({
    mutationFn: (data: CreateTargetInput) => targetsApi.create(orderLineId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'targets'] });
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'resolutions'] });
      toast.success('Target asignado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al asignar target');
    },
  });
}

export function useDeleteTarget(orderLineId: string) {
  return useMutation({
    mutationFn: (id: string) => targetsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'targets'] });
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'resolutions'] });
      toast.success('Target eliminado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar target');
    },
  });
}

// ─── Resolutions ─────────────────────────────────────────────────────────────

export function useResolutions(orderLineId: string | undefined) {
  return useQuery({
    queryKey: ['order-lines', orderLineId, 'resolutions'],
    queryFn: () => resolutionsApi.list(orderLineId!),
    enabled: !!orderLineId,
  });
}

// ─── Target Creatives ────────────────────────────────────────────────────────

export function useTargetCreatives(targetId: string | undefined) {
  return useQuery({
    queryKey: ['targets', targetId, 'creatives'],
    queryFn: () => creativesApi.listByTarget(targetId!),
    enabled: !!targetId,
  });
}

// ─── Bulk Creatives ──────────────────────────────────────────────────────────

export function useBulkCreateByResolution(orderLineId: string) {
  return useMutation({
    mutationFn: (data: BulkCreativeInput) => bulkCreativesApi.createByResolution(orderLineId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'resolutions'] });
      queryClient.invalidateQueries({ queryKey: ['targets'] });
      toast.success('Creativos asignados a todas las pantallas del grupo');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error en asignación bulk');
    },
  });
}

// ─── Creative for Target ─────────────────────────────────────────────────────

export function useCreateCreativeForTarget(targetId: string) {
  return useMutation({
    mutationFn: (data: CreateCreativeInput) => creativesApi.createForTarget(targetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets', targetId, 'creatives'] });
      toast.success('Creativo asignado');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al asignar creativo');
    },
  });
}

// ─── Content by Resolution ───────────────────────────────────────────────────

export function useContentByResolution(width?: number, height?: number) {
  return useQuery({
    queryKey: ['content', { width, height }],
    queryFn: () => contentApi.list({ width, height }),
    enabled: !!width && !!height,
  });
}
