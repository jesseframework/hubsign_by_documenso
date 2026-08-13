import { createContext, useContext } from 'react';
import React from 'react';

interface NonceProviderProps {
  children: React.ReactNode;
  nonce: string;
}

/**
 * The per-request CSP nonce, minted in `entry.server.tsx` and read by every
 * component that renders an inline `<script>`.
 *
 * The default is deliberately the empty string, and there is no provider on the
 * client: browsers hide the `nonce` content attribute after parsing, so
 * `getAttribute('nonce')` already reads as empty by hydration time. Server
 * `nonce="abc"` and client `nonce=""` therefore agree and React sees no
 * mismatch — which is also why a nonce can't leak back out through the DOM.
 */
const NonceContext = createContext<string>('');

export const useNonce = () => useContext(NonceContext);

export const NonceProvider = ({ children, nonce }: NonceProviderProps) => {
  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>;
};
