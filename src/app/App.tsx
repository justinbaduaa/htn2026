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
    <main className="app-shell">
      <header className="app-header">
        <a href="#" className="brand" aria-label="CADEX home"><img src="/cadex-logo.png" alt="CADEX" /></a>
        <nav><a href="#projects" className={hash === "#projects" ? "nav-active" : ""}>Projects</a><a href="#" className="nav-new">＋ New project</a></nav>
      </header>
      {id ? <ProjectPage key={id} id={id} /> : hash === '#projects' ? <ProjectList /> : <NewProject />}
    </main>
  );
}
