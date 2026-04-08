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
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [collections, setCollections] = useState<Array<{ id: string; name: string; items: number[] }>>([]);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" && window.localStorage.getItem("aiyo_collections");
      if (raw) setCollections(JSON.parse(raw) as Array<{ id: string; name: string; items: number[] }>);
    } catch { /* ignore */ }
  }, []);

  function saveCollections(updated: Array<{ id: string; name: string; items: number[] }>) {
    setCollections(updated);
    try {
      if (typeof window !== "undefined") window.localStorage.setItem("aiyo_collections", JSON.stringify(updated));
    } catch { /* ignore */ }
  }

  function handleCreateCollection() {
    if (!collectionName.trim()) return;
    const newCol = { id: `col-${Date.now()}`, name: collectionName.trim(), items: [] as number[] };
    saveCollections([...collections, newCol]);
    setCollectionName("");
    setShowCollectionModal(false);
  }

  function handleDeleteTrip(id: number) {
    void (async () => {
      try {
        const res = await apiFetchWithAuth(`${API_BASE_URL}/api/itinerary/${id}`, { method: "DELETE" });
        if (res.ok || res.status === 404) {
          setSavedItineraries((prev) => prev.filter((it) => it.id !== id));
        }
      } catch { /* ignore */ }
      setMenuOpenId(null);
    })();
  }

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
            <Button onClick={() => setShowCollectionModal(true)}>
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
                          <div className="relative">
                            <button
                              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
                              onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === item.id ? null : item.id); }}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {menuOpenId === item.id && (
                              <div className="absolute right-0 top-10 z-20 w-40 rounded-lg border border-border bg-surface p-1 shadow-modal">
                                <button
                                  className="w-full rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-surface-muted"
                                  onClick={(e) => { e.stopPropagation(); router.push(`/?itineraryId=${item.id}`); }}
                                >
                                  Open trip
                                </button>
                                <button
                                  className="w-full rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
                                  onClick={(e) => { e.stopPropagation(); handleDeleteTrip(item.id); }}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
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
            <div>
              {collections.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {collections.map((col) => (
                    <Card key={col.id} hoverable className="cursor-pointer">
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base">{col.name}</CardTitle>
                            <CardDescription className="mt-1">{col.items.length} items</CardDescription>
                          </div>
                          <button
                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
                            onClick={() => {
                              saveCollections(collections.filter((c) => c.id !== col.id));
                            }}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <FolderOpen size={48} className="mb-4 text-muted/30" />
                  <h3 className="text-lg font-semibold text-primary">No collections yet</h3>
                  <p className="mt-2 text-sm text-muted">
                    Organize your saved places into custom collections.
                  </p>
                  <Button variant="outline" className="mt-6" onClick={() => setShowCollectionModal(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Create collection
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === "guides" && (
            <div className="flex flex-col items-center justify-center py-16">
              <BookOpen size={48} className="mb-4 text-muted/30" />
              <h3 className="text-lg font-semibold text-primary">No guides yet</h3>
              <p className="mt-2 text-sm text-muted">
                Create travel guides from your experiences.
              </p>
              <Button variant="outline" className="mt-6" onClick={() => router.push("/")}>
                <Plus size={14} className="mr-1.5" />
                Start a trip first
              </Button>
            </div>
          )}
        </div>
      </main>

      {showCollectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCollectionModal(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-card border border-border bg-surface p-6 shadow-modal mx-4">
            <h3 className="text-lg font-semibold text-primary mb-4">New collection</h3>
            <input
              className="w-full rounded-lg border border-border bg-surface-muted px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-primary"
              placeholder="Collection name"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateCollection(); }}
            />
            <div className="mt-4 flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowCollectionModal(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreateCollection} disabled={!collectionName.trim()}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
