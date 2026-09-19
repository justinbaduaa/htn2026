import { useEffect, useState } from 'react';
import { ProjectList } from './ProjectList';
import { NewProject } from './NewProject';
import { ProjectPage } from './ProjectPage';

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const id = hash.startsWith('#p/') ? hash.slice(3) : null;
  return (
    <main className="mx-auto max-w-6xl p-6 text-sm">
      <header className="mb-6 flex items-baseline gap-4">
        <a href="#" className="text-base font-semibold">Photo to print</a>
        <a href="#projects" className="text-neutral-400 hover:text-white">Projects</a>
      </header>
      {id ? <ProjectPage id={id} /> : hash === '#projects' ? <ProjectList /> : <NewProject />}
    </main>
  );
}
