interface Props {
  audioUrl?: string;
  streamAudioUrl?: string;
}

export default function Player({ audioUrl, streamAudioUrl }: Props) {
  const src = audioUrl || streamAudioUrl;
  if (!src) return null;
  return (
    <audio className="player" controls preload="none" src={src}>
      Twoja przeglądarka nie obsługuje odtwarzacza audio.
    </audio>
  );
}
