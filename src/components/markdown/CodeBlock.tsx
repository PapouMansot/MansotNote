/**
 * CodeBlock — bloc de code coloré (Shiki lazy) + bouton « Copier ».
 *
 * Le HTML Shiki est injecté après chargement du highlighter ; en
 * attendant (et en cas d'échec), repli sur un `<pre>` brut. Le thème
 * (github-dark / github-light) suit `useTheme`.
 */
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyText } from '@/lib/clipboard';
import { highlightCode } from '@/lib/markdown';
import { useTheme } from '@/hooks/useTheme';

export interface CodeBlockProps {
  code: string;
  lang: string;
}

export function CodeBlock({ code, lang }: CodeBlockProps) {
  const { isDark } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHtml(null);
    highlightCode(code, lang, isDark ? 'dark' : 'light')
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, isDark]);

  const onCopy = () => {
    void copyText(code).then((ok) => {
      if (!ok) {
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="group my-4 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200/70 bg-zinc-100/70 px-3.5 py-1.5 dark:border-zinc-800/70 dark:bg-zinc-900/80">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {lang}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
            copied
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
          )}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <div className="overflow-x-auto">
        {html !== null ? (
          <div
            className="font-mono text-[13px] leading-relaxed [&>pre]:!m-0 [&>pre]:!p-4 [&>pre]:!bg-transparent [&>pre]:!outline-none"
            // Le HTML est produit par Shiki à partir du code de la note,
            // puis nettoyé : injection contrôlée.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className={cn('!m-0 !p-4 font-mono text-[13px] leading-relaxed', loading && 'opacity-60')}>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
