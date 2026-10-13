import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'emergency' | 'success' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  msg: string;
  isHiding?: boolean;
}

interface ToastContextType {
  showToast: (type: ToastType, title: string, msg: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isHiding: true } : t))
    );
    setTimeout(() => removeToast(id), 320);
  }, [removeToast]);

  const showToast = useCallback((type: ToastType, title: string, msg: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { id, type, title, msg };
    
    setToasts((prev) => [...prev, newToast]);

    // Auto close after 4.2 seconds
    setTimeout(() => {
      hideToast(id);
    }, 4200);
  }, [hideToast]);

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'emergency': return '🚨';
      case 'success': return '✅';
      case 'info': return 'ℹ️';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  };

  const getClass = (type: ToastType) => {
    switch (type) {
      case 'emergency': return 'ti-emerg';
      case 'success': return 'ti-ok';
      case 'info': return 'ti-info';
      case 'warning': return 'ti-warn';
      default: return 'ti-info';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div id="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.isHiding ? 'hiding' : ''}`}
            style={{ pointerEvents: 'all' }}
          >
            <div className={`toast-icon ${getClass(t.type)}`}>
              {getIcon(t.type)}
            </div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              <div className="toast-msg">{t.msg}</div>
            </div>
            <button className="toast-close" onClick={() => hideToast(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
