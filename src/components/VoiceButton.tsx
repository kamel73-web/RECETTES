import { useEffect, useRef, useState } from 'react';

interface RecognitionResultLike {
  0: { transcript: string };
}
interface RecognitionEventLike {
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Ajoute le texte dicté à la fin du texte existant (majuscule si le champ est vide).
export function appendDictation(existing: string, dictated: string): string {
  const add = dictated.trim();
  if (!add) return existing;
  const base = existing.replace(/\s+$/, '');
  if (!base) return add.charAt(0).toUpperCase() + add.slice(1);
  return base + ' ' + add;
}

function errorMessage(code: string): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return "Micro refusé : autorise-le dans le navigateur (icône cadenas de la barre d'adresse).";
    case 'no-speech':
      return 'Aucune voix détectée, réessaie.';
    case 'audio-capture':
      return 'Aucun micro détecté.';
    case 'network':
      return 'Dictée indisponible : vérifie ta connexion internet.';
    default:
      return 'Erreur de dictée (' + code + ').';
  }
}

export function VoiceButton({
  onText,
  compact = false,
}: {
  onText: (text: string) => void;
  compact?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText; // toujours la dernière version, pas de valeur périmée

  useEffect(() => {
    return () => {
      recRef.current?.abort();
    };
  }, []);

  const Ctor = getRecognitionCtor();
  if (!Ctor) return null; // navigateur sans dictée (ex. Firefox) : pas de bouton

  function toggle() {
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    setMessage(null);
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      text = text.trim();
      if (text) onTextRef.current(text);
    };
    rec.onerror = (e) => {
      setMessage(errorMessage(e.error));
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setMessage('Impossible de démarrer le micro, réessaie.');
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        title={listening ? 'Arrêter la dictée' : 'Dicter au micro'}
        style={{ background: listening ? '#fde7e9' : undefined }}
      >
        {listening ? (compact ? '⏹' : '⏹ Arrêter') : compact ? '🎤' : '🎤 Dicter'}
      </button>
      {message && (
        <span style={{ color: '#b00020', fontSize: 12, maxWidth: 220 }}>{message}</span>
      )}
    </span>
  );
}
