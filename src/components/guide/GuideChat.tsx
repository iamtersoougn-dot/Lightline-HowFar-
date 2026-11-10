import React, { useEffect, useRef, useState } from 'react';
import { Cloud, Info, Mic, MicOff, Send, Smartphone, Volume2, VolumeX, X } from 'lucide-react';
import type { ChatAnswer } from '../../agent/types';
import type { DailyGuide } from '../../hooks/useDailyGuide';

interface Msg {
  id: number;
  from: 'you' | 'guide';
  text: string;
  answer?: ChatAnswer;
}

const SUGGESTIONS = {
  en: ['Wetin dey today?', 'How much fuel will I need this week?', 'When will light go tonight?', 'Is my bank working?', 'How much have I spent this week?'],
  pcm: ['Wetin dey today?', 'How much fuel I go need this week?', 'When light go go tonight?', 'My bank dey work?', 'How much I don spend this week?']
};

// Browser speech APIs (available in Chrome on Android; not in every WebView)
type Recognizer = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function getRecognizer(): Recognizer | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const C = w.SpeechRecognition || w.webkitSpeechRecognition;
  return C ? new C() : null;
}

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const v = voices.find((x) => x.lang === 'en-NG') || voices.find((x) => x.lang.startsWith('en-GB')) || voices.find((x) => x.lang.startsWith('en'));
    if (v) u.voice = v;
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    // Read-aloud is optional
  }
}

interface Props {
  guide: DailyGuide;
  onClose: () => void;
}

/** Chat with the Daily Guide, in English or Pidgin, by typing or voice. */
export default function GuideChat({ guide, onClose }: Props) {
  const { settings } = guide;
  const lang = settings.language;
  const L = (en: string, pcm: string) => (lang === 'pcm' ? pcm : en);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: 0,
      from: 'guide',
      text: L(
        'Ask me about light, gen fuel, fuel prices, fares, your bank or your spending. English or Pidgin.',
        'Ask me anything about light, gen fuel, fuel price, fare, your bank or wetin you spend. English or Pidgin.'
      )
    }
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const recRef = useRef<Recognizer | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const voiceSupported = typeof window !== 'undefined' && !!getRecognizer();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  useEffect(() => () => {
    recRef.current?.stop();
    try { window.speechSynthesis?.cancel(); } catch { /* optional */ }
  }, []);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setDraft('');
    setMsgs((m) => [...m, { id: Date.now(), from: 'you', text: question }]);
    setBusy(true);
    const a = await guide.ask(question);
    setBusy(false);
    if (!a) return;
    setMsgs((m) => [...m, { id: Date.now() + 1, from: 'guide', text: a.text, answer: a }]);
    if (readAloud) speak(a.text);
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognizer();
    if (!rec) return;
    rec.lang = 'en-NG';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript || '';
      if (text) send(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="chat-title">
      <div
        className="w-full sm:max-w-md h-[88%] sm:h-[80%] bg-slate-950 border border-slate-800 sm:rounded-2xl rounded-t-2xl flex flex-col"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <div className="min-w-0 flex-1">
            <h2 id="chat-title" className="text-sm font-extrabold text-white">{L('Ask the Daily Guide', 'Ask Daily Guide')}</h2>
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              {settings.aiChatOnline ? (
                <>
                  <Cloud className="w-3 h-3" />
                  {L('Smarter answers on. Bank details stay on this phone', 'Smarter answer dey on. Bank details no dey comot')}
                  {settings.shareMoneyWithAi ? L(' (totals shared)', ' (only totals)') : ''}
                </>
              ) : (
                <>
                  <Smartphone className="w-3 h-3" />
                  {L('Answered on this phone. Works offline', 'Na this phone dey answer. E work without data')}
                </>
              )}
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800" role="group" aria-label="Language">
            {(['en', 'pcm'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => guide.updateSettings({ language: l })}
                aria-pressed={lang === l}
                className={`px-2 py-0.5 text-[11px] rounded-md font-semibold ${lang === l ? 'bg-emerald-500 text-slate-950' : 'text-slate-400'}`}
              >
                {l === 'en' ? 'English' : 'Pidgin'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setReadAloud((v) => !v)} aria-pressed={readAloud} aria-label="Read answers aloud" className="p-2 rounded-lg text-slate-300 hover:bg-slate-800">
            {readAloud ? <Volume2 className="w-4 h-4 text-emerald-300" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close chat" className="p-2 rounded-lg text-slate-300 hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {msgs.map((m) => (
            <div key={m.id} className={m.from === 'you' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-line ${m.from === 'you' ? 'bg-emerald-500 text-slate-950 rounded-br-md' : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-md'}`}>
                {m.text}
                {m.answer && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-800 text-[11px] text-slate-400 flex items-start gap-1">
                    <Info className="w-3 h-3 mt-px shrink-0" />
                    <span>
                      {m.answer.why}
                      <span className="block text-slate-500">
                        {m.answer.source === 'AI' ? L('Worded by AI from your figures', 'AI write am from your numbers') : L('Answered on this phone', 'Na this phone answer am')}
                        {m.answer.note ? ` · ${m.answer.note}` : ''}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-[12px] text-slate-400">{L('Thinking…', 'I dey think…')}</div>}
          <div ref={endRef} />
        </div>

        <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto">
          {SUGGESTIONS[lang].map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="shrink-0 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-200">
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="flex items-center gap-2 p-3"
        >
          <label htmlFor="guide-question" className="sr-only">{L('Your question', 'Your question')}</label>
          <input
            id="guide-question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={300}
            placeholder={L('Ask in English or Pidgin…', 'Ask for English or Pidgin…')}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={listening ? 'Stop listening' : 'Ask by voice'}
              className={`p-2.5 rounded-xl border ${listening ? 'bg-rose-500 border-rose-500 text-white animate-pulse' : 'bg-slate-900 border-slate-800 text-slate-200'}`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <button type="submit" disabled={!draft.trim() || busy} aria-label="Send" className="p-2.5 rounded-xl bg-emerald-500 disabled:opacity-40 text-slate-950">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
