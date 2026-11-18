import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { Avatar } from '../ui/Avatar';
import { CheckCheck, ShieldCheck, Sparkles, Zap } from 'lucide-react';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  compact = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`auth-page${compact ? ' auth-compact' : ''}`}>
      <section className="auth-hero" aria-hidden={compact ? 'true' : undefined}>
        <Link to="/login" className="auth-brand">
          <Logo size={38} withWord />
        </Link>
        <div className="auth-hero-copy">
          <span className="eyebrow">
            <Sparkles size={14} />
            Comunicação em tempo real
          </span>
          <h1>
            O seu time,
            <br />
            <span className="accent-text">em sintonia.</span>
          </h1>
          <p>
            Conversas, comunidades e chamadas em um só lugar. Rápido, privado e feito
            para acompanhar você em qualquer tela.
          </p>
          <ul className="auth-features">
            <li>
              <Zap size={16} /> Mensagens instantâneas e chamadas de voz ou vídeo
            </li>
            <li>
              <ShieldCheck size={16} /> Sessões protegidas e controle de privacidade
            </li>
            <li>
              <CheckCheck size={16} /> Sincronizado em todos os seus dispositivos
            </li>
          </ul>
        </div>

        {!compact && (
          <div className="auth-preview">
            <div className="preview-head">
              <span className="preview-dot" />
              <span># produto-design</span>
              <span className="preview-badge">ao vivo</span>
            </div>
            <div className="preview-message">
              <Avatar name="Marina Lopes" size={30} presence="online" />
              <div>
                <strong>Marina</strong>
                <p>A nova identidade visual está pronta para revisão ✨</p>
              </div>
              <span className="preview-time">09:41</span>
            </div>
            <div className="preview-message">
              <Avatar name="Rafael Nunes" size={30} presence="away" />
              <div>
                <strong>Rafael</strong>
                <p>Ficou impecável. Podemos apresentar hoje?</p>
              </div>
              <span className="preview-time">09:42</span>
            </div>
            <div className="preview-call">
              <span className="preview-call-icon">▶</span>
              <div>
                <strong>Chamada de vídeo</strong>
                <p>Marina, Rafael e você</p>
              </div>
              <span className="preview-live">12:08</span>
            </div>
          </div>
        )}

        <footer className="auth-hero-foot">
          <span>© {new Date().getFullYear()} UNISON</span>
          <span>Privacidade por padrão</span>
        </footer>
      </section>

      <section className="auth-panel">
        <div className="auth-mobile-brand">
          <Logo size={32} withWord />
        </div>
        <div className="auth-card">
          <header className="auth-card-head">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </header>
          {children}
          {footer && <footer className="auth-card-foot">{footer}</footer>}
        </div>
      </section>
    </div>
  );
}
