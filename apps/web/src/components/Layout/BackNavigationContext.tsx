import { createContext, useContext } from 'react';

interface BackNavigationContextValue {
  canGoBack: boolean;
  onBack?: () => void;
}

const BackNavigationContext = createContext<BackNavigationContextValue>({ canGoBack: false });

export const BackNavigationProvider = BackNavigationContext.Provider;

export function useBackNavigation() {
  return useContext(BackNavigationContext);
}
