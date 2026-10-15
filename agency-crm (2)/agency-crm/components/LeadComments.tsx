'use client';

import { useState } from 'react';
import { CornerDownLeft, FileSpreadsheet, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppContext';
import { useSupabase } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Note } from '@/lib/types';

/** التعليقات والملاحظات + الردود عليها */
export default function LeadComments({
  leadId, notes, onChanged, bare = false,
}: { leadId: string; notes: Note[]; onChanged: () => void; bare?: boolean }) {
  const { tr } = useI18n();
  const roots = notes.filter((n) => !n.parent_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const repliesOf = (id: string) =>
    notes.filter((n) => n.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div className={bare ? '' : 'card p-4'}>
      <h2 className="mb-3 flex items-center gap-2 font-bold">
        <MessageSquare size={18} /> {tr('التعليقات والملاحظات', 'Comments & notes')}
        {roots.length > 0 && <span className="text-xs font-normal text-slate-400">({notes.length})</span>}
      </h2>
      {roots.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">{tr('لسه مفيش تعليقات', 'No comments yet')}</p>
      ) : (
        <div className="space-y-3">
          {roots.map((n) => (
            <Thread key={n.id} leadId={leadId} root={n} replies={repliesOf(n.id)} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function Thread({ leadId, root, replies, onChanged }: { leadId: string; root: Note; replies: Note[]; onChanged: () => void }) {
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const { tr } = useI18n();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const nameOf = (uid?: string | null) => (uid ? team.find((t) => t.id === uid)?.full_name ?? tr('يوزر', 'User') : tr('السيستم', 'System'));

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    const { error } = await supabase.from('lead_notes').insert({
      lead_id: leadId, user_id: profile.id, body: text.trim(), parent_id: root.id,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    setText('');
    setReplying(false);
    onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200">
      <div className={`rounded-t-xl p-3 ${root.source === 'import' ? 'bg-sky-50' : 'bg-amber-50'}`}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <b className="text-slate-700">{nameOf(root.user_id)}</b>
          {root.source === 'import' && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
              <FileSpreadsheet size={11} /> {tr('من الشيت', 'From sheet')}
            </span>
          )}
          <span>{fmtDateTime(root.created_at)}</span>
        </div>
        <div className="whitespace-pre-wrap text-sm">{root.body}</div>
      </div>

      {replies.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 p-3 ps-6">
          {replies.map((r) => (
            <div key={r.id} className="text-sm">
              <div className="text-xs text-slate-500">
                <b className="text-slate-700">{nameOf(r.user_id)}</b> · {fmtDateTime(r.created_at)}
              </div>
              <div className="whitespace-pre-wrap">{r.body}</div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-slate-100 px-3 py-2">
        {replying ? (
          <div className="flex items-end gap-2">
            <textarea
              autoFocus
              rows={2}
              className="input"
              placeholder={tr('اكتب ردك…', 'Write a reply…')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
            />
            <button className="btn-primary px-3" disabled={sending || !text.trim()} onClick={send} aria-label={tr('إرسال', 'Send')}>
              <Send size={16} className="rtl:-scale-x-100" />
            </button>
          </div>
        ) : (
          <button className="flex items-center gap-1 text-xs font-semibold text-indigo-600" onClick={() => setReplying(true)}>
            <CornerDownLeft size={14} /> {tr('رد', 'Reply')}
          </button>
        )}
      </div>
    </div>
  );
}
