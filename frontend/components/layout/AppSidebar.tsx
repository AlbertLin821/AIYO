"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageCircle,
  Search,
  Heart,
  Map,
  Bell,
  Compass,
  PlusCircle,
  MoreHorizontal,
  Sparkles,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

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
  { id: "trips", label: "Trips", href: "/trips", icon: <Map size={20} /> },
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
    if (typeof window !== "undefined") window.localStorage.removeItem("aiyo_token");
    setOpen(false);
    router.replace("/login");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-muted transition-colors"
      >
        <Avatar
          src={user.avatar}
          fallback={user.name.charAt(0).toUpperCase()}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-primary">{user.name}</p>
          <p className="truncate text-xs text-muted">@{user.username}</p>
        </div>
        <MoreHorizontal size={16} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-surface py-1 shadow-modal animate-fade-in">
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
    <aside
      className={cn(
        "flex h-screen w-sidebar flex-col border-r border-border bg-surface",
        className
      )}
    >
      <Link
        href="/home"
        className="flex items-center gap-2 px-5 py-4 cursor-pointer hover:opacity-80 transition-opacity"
      >
        <Sparkles size={22} className="text-primary" />
        <span className="text-lg font-bold tracking-tight">AIYO.</span>
      </Link>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {navItems.map((item) => {
          const badge = getBadge(item.id);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeId === item.id
                  ? "bg-surface-muted text-primary"
                  : "text-muted hover:bg-surface-muted hover:text-primary"
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {badge !== undefined && (
                <span className="text-xs text-muted">{badge}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-2">
        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-primary hover:bg-surface-muted transition-colors"
        >
          New chat
        </button>
      </div>

      <div className="border-t border-border px-4 py-3">
        {user ? (
          <UserMenu user={user} />
        ) : (
          <div className="flex flex-col gap-2">
            <Link
              href="/login"
              className="block rounded-lg border border-border px-3 py-2 text-center text-sm font-medium text-primary hover:bg-surface-muted transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/login"
              className="block rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
