import { useVersionStatus } from '@fayda/api-client';
import { UpdateRequired, VersionNote } from '@fayda/ui';
import type { ReactNode } from 'react';

/** Blocks the app with "please update" when the server no longer accepts this version; notes when the app is newer than the server. */
export function VersionGate({ children }: { children: ReactNode }) {
  const { status } = useVersionStatus('buyer');
  if (status === 'update-required') return <UpdateRequired appName="Fayda Buyer" />;
  return (
    <>
      {status === 'server-older' ? <VersionNote /> : null}
      {children}
    </>
  );
}
