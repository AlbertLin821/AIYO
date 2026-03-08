"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import {
  MapPin,
  Heart,
  FolderOpen,
  BookOpen,
  Plus,
  Calendar,
  MoreHorizontal,
} from "lucide-react";
import { API_BASE_URL, apiFetchWithAuth, getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";

type SavedTab = "places" | "collections" | "guides";

type SavedItinerary = {
  id: number;
  title?: string | null;
  session_id?: string;
  days_count?: number;
  status?: string;
  updated_at?: string;
};

export default function SavedPage() {
  const router = useRouter();
  const { user } = useAuthUser();
  const [activeTab, setActiveTab] = useState<SavedTab>("places");
  const [savedItineraries, setSavedItineraries] = useState<SavedItinerary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSaved() {
      const token = getAccessToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        const response = await apiFetchWithAuth(`${API_BASE_URL}/api/itinerary`);
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.ok) {
          const data = (await response.json()) as { itineraries?: SavedItinerary[] };
          setSavedItineraries(data.itineraries || []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    void fetchSaved();
  }, [router]);

  const tabItems = [
    { id: "places" as const, label: "Places", icon: <MapPin size={14} />, count: savedItineraries.length },
    { id: "collections" as const, label: "Collections", icon: <FolderOpen size={14} /> },
    { id: "guides" as const, label: "Guides", icon: <BookOpen size={14} /> },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={user ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border bg-surface px-8 pt-8 pb-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-page-title text-primary">Saved</h1>
              <p className="mt-1 text-sm text-muted">
                Your saved trips, places, and collections.
              </p>
            </div>
            <Button>
              <Plus size={14} className="mr-1.5" />
              New collection
            </Button>
          </div>

          <div className="mt-6">
            <Tabs
              items={tabItems}
              activeId={activeTab}
              onChange={(id) => setActiveTab(id as SavedTab)}
            />
          </div>
        </div>

        <div className="px-8 py-8">
          {activeTab === "places" && (
            <div>
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-sm text-muted">Loading...</p>
                </div>
              ) : savedItineraries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Heart size={48} className="mb-4 text-muted/30" />
                  <h3 className="text-lg font-semibold text-primary">No saved trips yet</h3>
                  <p className="mt-2 text-sm text-muted">
                    Start a chat to plan your trip, then save it here.
                  </p>
                  <Button className="mt-6" onClick={() => router.push("/")}>
                    Start planning
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {savedItineraries.map((item) => (
                    <Card
                      key={item.id}
                      hoverable
                      className="cursor-pointer"
                      onClick={() => router.push(`/?itineraryId=${item.id}`)}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1">
                            <CardTitle className="text-base">
                              {item.title || "Untitled trip"}
                            </CardTitle>
                            <CardDescription className="mt-1">
                              <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1">
                                  <Calendar size={10} />
                                  {item.days_count || 0} days
                                </span>
                                {item.status && (
                                  <span className="rounded-btn bg-surface-muted px-2 py-0.5 text-xs">
                                    {item.status}
                                  </span>
                                )}
                              </div>
                            </CardDescription>
                          </div>
                          <button
                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                        {item.updated_at && (
                          <p className="mt-3 text-xs text-muted">
                            Updated {new Date(item.updated_at).toLocaleDateString()}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "collections" && (
            <div className="flex flex-col items-center justify-center py-16">
              <FolderOpen size={48} className="mb-4 text-muted/30" />
              <h3 className="text-lg font-semibold text-primary">No collections yet</h3>
              <p className="mt-2 text-sm text-muted">
                Organize your saved places into custom collections.
              </p>
              <Button variant="outline" className="mt-6">
                <Plus size={14} className="mr-1.5" />
                Create collection
              </Button>
            </div>
          )}

          {activeTab === "guides" && (
            <div className="flex flex-col items-center justify-center py-16">
              <BookOpen size={48} className="mb-4 text-muted/30" />
              <h3 className="text-lg font-semibold text-primary">No guides yet</h3>
              <p className="mt-2 text-sm text-muted">
                Create travel guides from your experiences.
              </p>
              <Button variant="outline" className="mt-6">
                <Plus size={14} className="mr-1.5" />
                Write a guide
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
