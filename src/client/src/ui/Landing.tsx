import { useRef, useState } from 'react';

interface Props {
  onCreate(): void;
  onFile(file: File): void;
  error: string | null;
}

/** Fresh opening: the title, one create-document bubble and one file pick/drop area. Nothing generates here. */
export function Landing({ onCreate, onFile, error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <main className="landing">
      <h1 className="brand-title">Bubbles.MD</h1>
      <p className="tagline">Select a passage, think out loud, and review a suggestion before anything changes.</p>
      <div className="landing-actions">
        <button type="button" className="bubble create-bubble" onClick={onCreate}>
          <span>New document</span>
          <span className="bubble landing-mini a" aria-hidden="true" />
          <span className="bubble landing-mini b" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`drop-area${over ? ' over' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
        >
          <strong>Open a Markdown file</strong>
          <span>Click to choose, or drop a .md file here</span>
        </button>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <p className="landing-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
