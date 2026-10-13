import { useEffect, useRef } from 'react';

type EventHandler = (data: any) => void;

// A single shared EventSource for the whole app — every component that wants
// real-time updates subscribes/unsubscribes to named event types on it rather
// than opening its own connection. EventSource reconnects automatically on
// its own (the browser retries using the `retry:` hint the server sends).
let sharedSource: EventSource | null = null;
let refCount = 0;
const listeners = new Map<string, Set<EventHandler>>();
const attachedNativeTypes = new Set<string>();

const ensureSource = () => {
  if (!sharedSource) {
    sharedSource = new EventSource('/api/events/stream');
    attachedNativeTypes.clear();
  }
  return sharedSource;
};

// Attaches exactly one native browser listener per event type, which fans the
// event out to every currently-subscribed React handler for that type.
const ensureNativeListener = (source: EventSource, eventType: string) => {
  if (attachedNativeTypes.has(eventType)) return;
  attachedNativeTypes.add(eventType);
  source.addEventListener(eventType, (evt: MessageEvent) => {
    let parsed: any = null;
    try { parsed = JSON.parse(evt.data); } catch { /* ignore malformed payloads */ }
    listeners.get(eventType)?.forEach((h) => h(parsed));
  });
};

/**
 * Subscribe to a real-time event type (e.g. "emergency:status", "emergency:matches").
 * Automatically shares one underlying connection and cleans up on unmount.
 */
export const useEventStream = (eventType: string, handler: EventHandler, active = true) => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;

    const wrapped = (data: any) => handlerRef.current(data);
    if (!listeners.has(eventType)) listeners.set(eventType, new Set());
    listeners.get(eventType)!.add(wrapped);

    const source = ensureSource();
    ensureNativeListener(source, eventType);
    refCount++;

    return () => {
      refCount--;
      listeners.get(eventType)?.delete(wrapped);
      if (refCount <= 0 && sharedSource) {
        sharedSource.close();
        sharedSource = null;
        attachedNativeTypes.clear();
        refCount = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, active]);
};
