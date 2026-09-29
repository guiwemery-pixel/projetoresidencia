import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudUpload, WifiOff } from 'lucide-react';
import { flushQueue, onQueueChange, pendingRequests } from '../../api/offline';
import { useToast } from '../ui';

// Aviso de "sem internet" e envio do que ficou guardado quando a conexão volta
// (ver api/offline.ts). Os flashcards têm a própria sincronização.

function subscribeOnline(fn: () => void) {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

export function OfflineBar() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const [pending, setPending] = useState(() => pendingRequests().length);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => onQueueChange(() => setPending(pendingRequests().length)), []);

  // Voltou a internet (ou abriu o site com algo na fila): envia e atualiza as telas
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    let cancelled = false;
    const send = async () => {
      if (!pendingRequests().length) {
        // As telas mostravam a cópia guardada: busca tudo de novo
        if (wasOffline.current) qc.invalidateQueries();
        wasOffline.current = false;
        return;
      }
      wasOffline.current = false;
      const { sent, failed } = await flushQueue();
      if (cancelled) return;
      if (sent) toast.success(sent === 1 ? 'Conexão de volta: 1 registro feito sem internet foi enviado.' : `Conexão de volta: ${sent} registros feitos sem internet foram enviados.`);
      for (const f of failed) toast.error(`${f.label} (feito sem internet) não foi aceito: ${f.message}`);
      qc.invalidateQueries();
    };
    send();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  if (online && !pending) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-warn-wash px-4 py-2 text-xs text-ink2 sm:px-6">
      {online ? <CloudUpload className="h-4 w-4 shrink-0" /> : <WifiOff className="h-4 w-4 shrink-0" />}
      <span>
        {online
          ? `Enviando ${pending} registro(s) feito(s) sem internet…`
          : `Sem internet: você vê os dados da última vez que abriu cada tela.${pending ? ` ${pending} registro(s) aguardando envio.` : ' O que registrar agora é enviado quando a conexão voltar.'} Os flashcards funcionam normalmente.`}
      </span>
    </div>
  );
}
