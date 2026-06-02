import { LuArchive as Archive, LuCircleUser as UserCircle, LuClock3 as Clock3, LuDownload as Download, LuGithub as Github, LuInbox as Inbox, LuLogOut as LogOut, LuPanelLeftClose as PanelLeftClose, LuPanelLeftOpen as PanelLeftOpen, LuSearch as Search, LuSettings as Settings } from 'react-icons/lu';
import { useId, useState } from 'react';
import type { SectionKey } from '@/types/domain';
import type { ServerSession } from '@/lib/sync/serverAuth';
import { cn } from '@/lib/cn';
import { isServerSessionExpired, normalizeServerUrl } from '@/lib/sync/serverAuth';
import { isHostedWebRuntime } from '@/lib/runtime';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { BrandMark } from './BrandMark';

const items: Array<{ key: SectionKey; label: string; icon: typeof Inbox }> = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'search', label: 'Search', icon: Search },
  { key: 'library', label: 'Library', icon: Archive }
];

const footerItems: Array<{ key: SectionKey; label: string; icon: typeof Inbox }> = [
  { key: 'history', label: 'History', icon: Clock3 },
  { key: 'downloads', label: 'Downloads', icon: Download },
  { key: 'settings', label: 'Settings', icon: Settings }
];

export function NavigationRail({
  active,
  onSelect,
  serverUrl,
  serverSession,
  onSignIn,
  onSignOut
}: {
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
  serverUrl?: string;
  serverSession: ServerSession | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const profileMenuId = useId();
  const profileMobileMenuId = useId();
  const hasServer = Boolean(normalizeServerUrl(serverUrl));
  const sessionExpired = isServerSessionExpired(serverSession);
  const hasSession = Boolean(serverSession && !sessionExpired);
  const hostedWebRuntime = isHostedWebRuntime();
  const profileLabel = hasSession ? (serverSession?.username || serverSession?.email || 'Signed in') : hostedWebRuntime ? 'Sign in' : 'Local';

  return (
    <aside
      className={cn(
        'scrollbar-soft relative hidden h-full w-[76px] shrink-0 flex-col items-center gap-4 overflow-y-auto border-r border-bone/15 bg-canvas/70 p-3 transition-[width] duration-200 md:row-span-2 md:flex md:items-stretch',
        collapsed ? 'md:w-[76px]' : 'md:w-[230px]'
      )}
    >
      <div className={cn('hidden min-h-[54px] items-start gap-2 md:flex', collapsed ? 'justify-center' : 'justify-between')}>
        <BrandMark collapsed={collapsed} />
        <IconButton
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => {
            setCollapsed((next) => !next);
            setProfileOpen(false);
          }}
          className="h-9 w-9 shrink-0"
        >
          {collapsed ? <PanelLeftOpen size={17} aria-hidden /> : <PanelLeftClose size={17} aria-hidden />}
        </IconButton>
      </div>
      <div className="md:hidden">
        <BrandMark />
      </div>
      <nav className="eh-sidebar-primary mt-3 grid gap-2" aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          const activeItem = active === item.key;
          return (
            <button
              key={item.key}
              aria-label={item.label}
              title={item.label}
              aria-current={activeItem ? 'page' : undefined}
              onClick={() => onSelect(item.key)}
              className={cn(
                'eh-sidebar-primary-item flex h-11 items-center justify-center gap-3 rounded-eh border border-transparent px-3 text-sm font-black uppercase tracking-[0.06em] text-bone transition hover:border-yellow/30 hover:text-yellow',
                collapsed ? 'md:justify-center md:px-0' : 'md:justify-start',
                activeItem && 'border-yellow/60 bg-yellow text-canvas hover:text-canvas'
              )}
            >
              <Icon size={20} aria-hidden />
              <span className={cn('eh-sidebar-primary-label hidden md:inline', collapsed && 'md:hidden')}>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="eh-sidebar-footer hidden md:block">
        <div className="relative grid gap-2">
          <nav className={cn('eh-sidebar-secondary grid gap-2', collapsed ? 'grid-cols-1' : 'grid-cols-1')} aria-label="Library and settings">
            {footerItems.map((item) => {
              const Icon = item.icon;
              const activeItem = active === item.key;
              return (
                <button
                  key={item.key}
                  aria-label={item.label}
                  title={item.label}
                  aria-current={activeItem ? 'page' : undefined}
                  onClick={() => onSelect(item.key)}
                  className={cn(
                    'eh-sidebar-secondary-item eh-tooltip flex h-10 min-w-0 items-center justify-start gap-3 rounded-eh border border-bone/15 bg-surface/70 px-3 text-sm font-black uppercase tracking-[0.05em] text-cream transition hover:border-yellow/50 hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow',
                    collapsed && 'md:grid md:w-10 md:place-items-center md:px-0',
                    activeItem && 'border-yellow bg-yellow text-canvas hover:text-canvas'
                  )}
                  data-tooltip={item.label}
                >
                  <Icon size={18} aria-hidden />
                  <span className={cn('eh-sidebar-secondary-label truncate', collapsed && 'md:hidden')}>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="mt-auto hidden md:block">
        <div className="relative grid gap-2">
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            aria-label={hasSession ? `Open profile options for ${profileLabel}` : 'Open sign in options'}
            title={hasSession ? `Profile: ${profileLabel}` : 'Profile: Local'}
            aria-expanded={profileOpen}
            aria-controls={profileMenuId}
            aria-haspopup="menu"
            className={cn(
              'flex min-w-0 items-center rounded-eh border border-bone/15 bg-surface/70 text-left transition hover:border-yellow/40 hover:text-yellow',
              collapsed ? 'h-10 w-10 justify-center p-0' : 'w-full gap-2 px-2 py-2'
            )}
          >
            <span
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-eh border',
                hasSession ? 'border-yellow/40 bg-yellow/15 text-yellow' : 'border-bone/15 bg-canvas/80 text-bone'
              )}
              aria-hidden
            >
              <UserCircle size={17} aria-hidden />
            </span>
            <span className={cn('min-w-0 flex-1 break-words text-[11px] font-black uppercase leading-tight tracking-[0.04em] text-cream', collapsed && 'hidden')}>{profileLabel}</span>
          </button>
          {profileOpen && (
            <div
              id={profileMenuId}
              role="menu"
              className={cn(
                'absolute bottom-full z-20 mb-2 grid gap-2 rounded-eh border border-bone/15 bg-canvas/95 p-3 shadow-xl shadow-black/30',
                collapsed ? 'left-0 w-[220px]' : 'left-0 right-0'
              )}
            >
              {hasSession ? (
                <>
                  <p className="text-xs leading-5 text-bone">Signed in with GitHub. Sync and search can use the server.</p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onSignOut();
                      setProfileOpen(false);
                    }}
                    aria-label="Sign out of the current GitHub session"
                  >
                    <LogOut size={16} aria-hidden />
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs leading-5 text-bone">
                    {hasServer ? 'Use GitHub sign-in to unlock sync and search.' : hostedWebRuntime ? 'Server sign-in is unavailable.' : 'Set a server URL in Settings first, then sign in with GitHub.'}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setProfileOpen(false);
                      onSignIn();
                    }}
                    aria-label={hasServer ? 'Sign in with GitHub' : 'Open server setup before signing in'}
                  >
                    <Github size={16} aria-hidden />
                    Sign in with GitHub
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-auto md:hidden">
        <div className="relative grid gap-2">
          {footerItems.map((item) => {
            const Icon = item.icon;
            return (
              <IconButton key={item.key} label={item.label} active={active === item.key} onClick={() => onSelect(item.key)}>
                <Icon size={18} aria-hidden />
              </IconButton>
            );
          })}
          <IconButton
            label={hasSession ? 'Profile options' : 'Sign in options'}
            active={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
          >
            <UserCircle size={18} aria-hidden />
          </IconButton>
          {profileOpen && (
            <div id={profileMobileMenuId} role="menu" className="absolute bottom-full left-0 z-20 mb-2 w-[220px] rounded-eh border border-bone/15 bg-canvas/95 p-3 shadow-xl shadow-black/30">
              <p className="text-xs leading-5 text-bone">
                {hasSession ? 'Signed in with GitHub. Sync and search can use the server.' : hasServer ? 'Use GitHub sign-in to unlock sync and search.' : 'Set a server URL in Settings first, then sign in with GitHub.'}
              </p>
              <div className="mt-3 grid gap-2">
                {hasSession ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onSignOut();
                      setProfileOpen(false);
                    }}
                    aria-label="Sign out of the current GitHub session"
                  >
                    <LogOut size={16} aria-hidden />
                    Sign out
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setProfileOpen(false);
                      onSignIn();
                    }}
                    aria-label={hasServer ? 'Sign in with GitHub' : 'Open server setup before signing in'}
                  >
                    <Github size={16} aria-hidden />
                    Sign in with GitHub
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export function MobileNavigationRail({
  active,
  onSelect,
  serverUrl,
  serverSession,
  onSignIn,
  onSignOut
}: {
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
  serverUrl?: string;
  serverSession: ServerSession | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuId = useId();
  const hasServer = Boolean(normalizeServerUrl(serverUrl));
  const sessionExpired = isServerSessionExpired(serverSession);
  const hasSession = Boolean(serverSession && !sessionExpired);
  const hostedWebRuntime = isHostedWebRuntime();
  const profileLabel = hasSession ? (serverSession?.username || serverSession?.email || 'Signed in') : hostedWebRuntime ? 'Sign in' : 'Local';
  const mobileItems = [...items, ...footerItems];

  return (
    <header className="relative flex shrink-0 items-center gap-2 overflow-x-auto border-b border-bone/15 bg-canvas/90 px-2 py-2 md:hidden" aria-label="Mobile navigation">
      {mobileItems.map((item) => {
        const Icon = item.icon;
        const activeItem = active === item.key;
        return (
          <button
            key={item.key}
            aria-label={item.label}
            title={item.label}
            aria-current={activeItem ? 'page' : undefined}
            onClick={() => {
              setProfileOpen(false);
              onSelect(item.key);
            }}
            className={cn(
              'eh-tooltip grid h-11 w-11 shrink-0 place-items-center rounded-eh border border-transparent text-bone transition hover:border-yellow/30 hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow',
              activeItem && 'border-yellow/60 bg-yellow text-canvas hover:text-canvas'
            )}
            data-tooltip={item.label}
          >
            <Icon size={20} aria-hidden />
          </button>
        );
      })}
      <button
        type="button"
        aria-label={hasSession ? `Open profile options for ${profileLabel}` : 'Open sign in options'}
        title={hasSession ? `Profile: ${profileLabel}` : 'Profile: Local'}
        aria-expanded={profileOpen}
        aria-controls={profileMenuId}
        aria-haspopup="menu"
        onClick={() => {
          if (!hasSession && !hasServer) {
            onSignIn();
            return;
          }
          setProfileOpen((open) => !open);
        }}
        className={cn(
          'eh-tooltip ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-eh border border-bone/15 bg-surface/70 text-cream transition hover:border-yellow/40 hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow',
          profileOpen && 'border-yellow bg-yellow text-canvas hover:text-canvas'
        )}
        data-tooltip={profileLabel}
      >
        <UserCircle size={20} aria-hidden />
      </button>
      {profileOpen ? (
        <div id={profileMenuId} role="menu" className="absolute right-2 top-full z-30 mt-2 w-[240px] rounded-eh border border-bone/15 bg-canvas/95 p-3 shadow-xl shadow-black/40">
          <p className="text-xs leading-5 text-bone">
            {hasSession ? `Signed in as ${profileLabel}.` : hasServer ? 'Use GitHub sign-in to unlock sync and search.' : hostedWebRuntime ? 'Server sign-in is unavailable.' : 'Set a server URL in Settings first, then sign in with GitHub.'}
          </p>
          <div className="mt-3 grid gap-2">
            {hasSession ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onSignOut();
                  setProfileOpen(false);
                }}
                aria-label="Sign out of the current GitHub session"
              >
                <LogOut size={16} aria-hidden />
                Sign out
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setProfileOpen(false);
                  onSignIn();
                }}
                aria-label={hasServer ? 'Sign in with GitHub' : 'Open server setup before signing in'}
              >
                <Github size={16} aria-hidden />
                Sign in
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
