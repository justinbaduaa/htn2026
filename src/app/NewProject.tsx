import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../shared/api';
import { useElapsed } from './useElapsed';
import { Generating } from './Generating';

/** Sizes a textarea to its content, so a long prompt is fully visible instead of scrolling inside a fixed box. */
const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };

export function NewProject() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [startedAt, setStartedAt] = useState<number>();
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const created = useRef<string | null>(null);
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);
  const addFiles = (incoming: File[]) => {
    const valid = incoming.filter(f => f.type.startsWith('image/'));
    setFileError(valid.length !== incoming.length ? 'Please attach image files only.' : '');
    setFiles(current => [...current, ...valid]);
    created.current = null;
  };
  const start = useMutation({
    mutationFn: async () => {
      setStartedAt(Date.now());
      if (!created.current) created.current = (await api.create(files, description)).id;
      await api.plan(created.current);
      return created.current;
    },
    onSuccess: id => { location.hash = `#p/${id}`; },
  });
  const elapsed = useElapsed(start.isPending, startedAt);
  return (
    <section className="new-project">
      <div className="atmosphere" aria-hidden="true"><i /><i /><i />{Array.from({ length: 18 }, (_, i) => <b key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 23) % 100}%`, animationDelay: `${i * -.8}s` }} />)}</div>
      <form className={`composer ${dragging ? 'is-dragging' : ''}`} onSubmit={e => { e.preventDefault(); if (files.length && description.trim() && !start.isPending) start.mutate(); }}
        onDragOver={e => { e.preventDefault(); if (!start.isPending) setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!start.isPending) addFiles([...e.dataTransfer.files]); }}>
        <h1 className="composer-heading">New project</h1>
        <textarea aria-label="Describe your project" disabled={start.isPending} value={description} rows={4}
          onChange={e => { setDescription(e.target.value); created.current = null; grow(e.currentTarget); }} ref={el => { if (el) grow(el); }}
          placeholder="Describe what you want to print…" required />
        {files.length > 0 && <div className="photo-attachments">{files.map((f, i) => <div className="attachment" key={`${f.name}-${i}`}><img src={previews[i]} alt={f.name} /><span>{i === 0 ? 'Top view' : `View ${i + 1}`}</span><button type="button" aria-label={`Remove ${f.name}`} disabled={start.isPending} onClick={() => { setFiles(files.filter((_, n) => n !== i)); created.current = null; }}>×</button></div>)}</div>}
        <div className="composer-footer"><input ref={input} type="file" accept="image/*" multiple className="sr-only" aria-label="Attach object photos" disabled={start.isPending} onChange={e => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} /><button type="button" className="attach-button" disabled={start.isPending} onClick={() => input.current?.click()}><span>＋</span> Add photos <small>{files.length}</small></button><button className="primary-button" disabled={!files.length || !description.trim() || start.isPending}>{start.isPending ? 'Analyzing…' : 'Continue'}</button></div>
        {fileError && <p className="error-message" role="alert">{fileError}</p>}
        {start.error && <p className="error-message" role="alert">{start.error.message} You can try again.</p>}
      </form>
      {start.isPending ? <Generating title="Analyzing photos" elapsed={elapsed} detail="Identifying measurements. Usually 30–90 seconds." /> : <p className="upload-hint">At least one photo required. Include top and side views.</p>}
    </section>
  );
}
