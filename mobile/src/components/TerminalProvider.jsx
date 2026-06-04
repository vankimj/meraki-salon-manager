import { tokenProvider } from '../lib/terminal';

// The native Terminal module is only present AFTER a rebuild that includes
// @stripe/stripe-terminal-react-native. We require it lazily so the current
// (pre-rebuild) JS bundle never throws: if the module is absent this provider
// is a transparent pass-through and the checkout Card button stays disabled
// (isTerminalAvailable() === false).
let SDK = null;
try { SDK = require('@stripe/stripe-terminal-react-native'); } catch { SDK = null; }

export default function TerminalProvider({ children }) {
  if (!SDK || !SDK.StripeTerminalProvider) return children;
  const { StripeTerminalProvider } = SDK;
  return (
    <StripeTerminalProvider logLevel="error" tokenProvider={tokenProvider}>
      {children}
    </StripeTerminalProvider>
  );
}
