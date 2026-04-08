"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Map, Calendar } from "lucide-react";
import { API_BASE_URL, apiFetchWithAuth, getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";

type SavedItinerary = {
  id: number;
  title?: string | null;
  days_count?: number;
  status?: string;
  updated_at?: string;
};

export default function TripsPage() {
  const router = useRouter();
  const { user } = useAuthUser();
  const [trips, setTrips] = useState<SavedItinerary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTrips() {
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
          setTrips(data.itineraries || []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    void fetchTrips();
  }, [router]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={user ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-surface px-8 pt-8 pb-0">
          <h1 className="text-page-title text-primary">Trips</h1>
          <p className="mt-1 text-sm text-muted">
            Your saved trips. Click a trip to open and continue planning.
          </p>
        </div>

        <div className="px-8 py-8">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted">Loading...</p>
            </div>
          ) : trips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Map size={48} className="mb-4 text-muted/30" />
              <h3 className="text-lg font-semibold text-primary">No trips yet</h3>
              <p className="mt-2 text-sm text-muted">
                Create a trip from the main chat, then it will appear here.
              </p>
              <Button className="mt-6" onClick={() => router.push("/")}>
                Start planning
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {trips.map((item) => (
                <Card
                  key={item.id}
                  hoverable
                  className="cursor-pointer"
                  onClick={() => router.push(`/?itineraryId=${item.id}`)}
                >
                  <CardContent className="p-5">
                    <CardTitle className="text-base">
                      {item.title || "Untitled trip"}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {item.days_count ?? 0} days
                        </span>
                        {item.status && (
                          <span className="rounded-btn bg-surface-muted px-2 py-0.5 text-xs">
                            {item.status}
                          </span>
                        )}
                      </div>
                    </CardDescription>
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
      </main>
    </div>
  );
}
