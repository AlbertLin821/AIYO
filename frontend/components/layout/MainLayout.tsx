"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./AppSidebar";

interface MainLayoutProps {
  children: React.ReactNode;
  user?: { name: string; username: string; avatar?: string } | null;
  chatCount?: number;
  savedCount?: number;
  onNewChat?: () => void;
  hideSidebar?: boolean;
}

export function MainLayout({
  children,
  user,
  chatCount,
  savedCount,
  onNewChat,
  hideSidebar = false,
}: MainLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {!hideSidebar && (
        <AppSidebar
          user={user}
          chatCount={chatCount}
          savedCount={savedCount}
          onNewChat={onNewChat}
        />
      )}
      <main className={cn("flex-1 overflow-hidden", !hideSidebar && "flex flex-col")}>
        {children}
      </main>
    </div>
  );
}
