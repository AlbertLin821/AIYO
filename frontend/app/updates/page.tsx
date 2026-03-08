"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Bell } from "lucide-react";
import { getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";

export default function UpdatesPage() {
  const router = useRouter();
  const { user } = useAuthUser();

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={user ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-surface px-8 pt-8 pb-0">
          <h1 className="text-page-title text-primary">Updates</h1>
          <p className="mt-1 text-sm text-muted">
            Trip and collaboration updates. Notifications will appear here.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center px-8 py-16">
          <Bell size={48} className="mb-4 text-muted/30" />
          <h3 className="text-lg font-semibold text-primary">No updates yet</h3>
          <p className="mt-2 max-w-sm text-center text-sm text-muted">
            When you get trip reminders or when collaborators edit shared trips, they will show up here.
          </p>
        </div>
      </main>
    </div>
  );
}
