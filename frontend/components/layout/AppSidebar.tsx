"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageCircle,
  Search,
  Heart,
  Map as MapIcon,
  Bell,
  Compass,
  PlusCircle,
  MoreHorizontal,
  Sparkles,
  Globe,
  Settings,
  LogOut,
  LogIn,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { clearAccessToken } from "@/lib/api";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: "chats", label: "Chats", href: "/", icon: <MessageCircle size={20} /> },
  { id: "explore", label: "Explore", href: "/explore", icon: <Search size={20} /> },
  { id: "saved", label: "Saved", href: "/saved", icon: <Heart size={20} /> },
  { id: "trips", label: "Trips", href: "/trips", icon: <MapIcon size={20} /> },
  { id: "updates", label: "Updates", href: "/updates", icon: <Bell size={20} /> },
  { id: "inspiration", label: "Inspiration", href: "/inspiration", icon: <Compass size={20} /> },
  { id: "create", label: "Create", href: "/create", icon: <PlusCircle size={20} /> },
];

interface AppSidebarProps {
  user?: { name: string; username: string; avatar?: string } | null;
  chatCount?: number;
  savedCount?: number;
  className?: string;
  onNewChat?: () => void;
}

function UserMenu({ user }: { user: { name: string; username: string; avatar?: string } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  function handleLogout() {
    clearAccessToken();
    setOpen(false);
    router.replace("/login");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-muted transition-colors group-hover:justify-start"
      >
        <Avatar
          src={user.avatar}
          fallback={user.name.charAt(0).toUpperCase()}
          size="sm"
          className="shrink-0"
        />
        <div className="min-w-0 flex-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <p className="truncate text-sm font-medium text-primary">{user.name}</p>
          <p className="truncate text-xs text-muted">@{user.username}</p>
        </div>
        <MoreHorizontal size={16} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-[60] mb-1 min-w-[200px] rounded-lg border border-border bg-surface py-1 shadow-modal animate-fade-in">
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-primary hover:bg-surface-muted transition-colors"
          >
            <Settings size={16} className="text-muted" />
            Settings
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-primary hover:bg-surface-muted transition-colors"
          >
            <LogOut size={16} className="text-muted" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppSidebar({ user, chatCount, savedCount, className, onNewChat }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleNewChat = React.useCallback(() => {
    if (onNewChat) {
      onNewChat();
    } else {
      router.push("/");
    }
  }, [onNewChat, router]);

  const getActiveId = () => {
    if (pathname === "/" || pathname.startsWith("/chat")) return "chats";
    for (const item of navItems) {
      if (item.href !== "/" && pathname.startsWith(item.href)) return item.id;
    }
    return "chats";
  };

  const activeId = getActiveId();

  const getBadge = (id: string) => {
    if (id === "chats" && chatCount) return chatCount;
    if (id === "saved" && savedCount) return savedCount;
    return undefined;
  };

  return (
    <div className="relative w-16 shrink-0">
      <aside
        className={cn(
          "group absolute left-0 top-0 z-50 flex h-screen w-16 flex-col overflow-x-hidden border-r border-border bg-surface",
          "transition-[width,box-shadow] duration-300 ease-smooth",
          "hover:w-sidebar hover:shadow-modal",
          className
        )}
      >
        <Link
          href="/home"
          className="flex items-center gap-2 px-3 py-4 transition-opacity hover:opacity-90"
        >
          <span className="mx-auto flex shrink-0 items-center gap-1 group-hover:mx-0">
            <Sparkles size={22} className="text-primary" />
            <Globe size={16} className="text-travel-ocean opacity-80" aria-hidden />
          </span>
          <span className="whitespace-nowrap text-lg font-bold tracking-tight opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            AIYO.
          </span>
        </Link>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 py-2">
          {navItems.map((item) => {
            const badge = getBadge(item.id);
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg py-2.5 pl-3 pr-2 text-sm font-medium transition-colors",
                  activeId === item.id
                    ? "bg-surface-muted text-primary"
                    : "text-muted hover:bg-surface-muted hover:text-primary"
                )}
              >
                <span className="mx-auto shrink-0 group-hover:mx-0">{item.icon}</span>
                <span className="flex-1 whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  {item.label}
                </span>
                {badge !== undefined && (
                  <span className="hidden text-xs text-muted group-hover:inline">{badge}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 px-2 pb-2">
          <button
            type="button"
            onClick={handleNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-primary hover:bg-surface-muted transition-colors group-hover:px-3"
          >
            <PlusCircle size={20} className="shrink-0" />
            <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              New chat
            </span>
          </button>
        </div>

        <div className="shrink-0 border-t border-border px-2 py-3">
          {user ? (
            <UserMenu user={user} />
          ) : (
            <div className="flex flex-col gap-2">
              <Link
                href="/login"
                className="flex items-center justify-center gap-2 rounded-lg border border-border py-2 text-center text-sm font-medium text-primary hover:bg-surface-muted transition-colors group-hover:px-3"
              >
                <LogIn size={18} className="shrink-0" />
                <span className="whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">Log in</span>
              </Link>
              <Link
                href="/login"
                className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors group-hover:px-3"
              >
                <UserPlus size={18} className="shrink-0" />
                <span className="whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">Sign up</span>
              </Link>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
