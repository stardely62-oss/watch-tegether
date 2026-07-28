import { useEffect } from 'react';

export function useEscape(onClose) {
  useEffect(() => {
    if (!onClose) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}
