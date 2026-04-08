"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardImage, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import {
  Search,
  MapPin,
  Utensils,
  Hotel,
  Camera,
  Compass,
  TrendingUp,
  Star,
  Calendar,
} from "lucide-react";
import { API_BASE_URL, apiFetchWithAuth, getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";

type ExploreCategory = "all" | "sights" | "food" | "hotels" | "experiences";

const categories = [
  { id: "all" as const, label: "All", icon: <Compass size={14} /> },
  { id: "sights" as const, label: "Sights", icon: <Camera size={14} /> },
  { id: "food" as const, label: "Food & drink", icon: <Utensils size={14} /> },
  { id: "hotels" as const, label: "Hotels", icon: <Hotel size={14} /> },
  { id: "experiences" as const, label: "Experiences", icon: <Star size={14} /> },
];

const trendingPlaces = [
  { id: "1", name: "Jiufen Old Street", location: "New Taipei", category: "sights", image: null, rating: 4.5 },
  { id: "2", name: "Din Tai Fung", location: "Taipei", category: "food", image: null, rating: 4.7 },
  { id: "3", name: "Sun Moon Lake", location: "Nantou", category: "sights", image: null, rating: 4.6 },
  { id: "4", name: "Raohe Night Market", location: "Taipei", category: "food", image: null, rating: 4.4 },
  { id: "5", name: "Taroko Gorge", location: "Hualien", category: "experiences", image: null, rating: 4.8 },
  { id: "6", name: "Eslite Hotel", location: "Taipei", category: "hotels", image: null, rating: 4.3 },
  { id: "7", name: "Alishan Forest Railway", location: "Chiayi", category: "experiences", image: null, rating: 4.5 },
  { id: "8", name: "Shilin Night Market", location: "Taipei", category: "food", image: null, rating: 4.2 },
];

const popularDestinations = [
  { name: "Taipei", count: "2,340 places" },
  { name: "Kyoto", count: "1,890 places" },
  { name: "Bangkok", count: "3,120 places" },
  { name: "Seoul", count: "2,670 places" },
  { name: "Bali", count: "1,450 places" },
  { name: "Tokyo", count: "4,230 places" },
];

type SavedItinerary = {
  id: number;
  title?: string | null;
  days_count?: number;
  status?: string;
};

export default function ExplorePage() {
  const router = useRouter();
  const { user } = useAuthUser();
  const [activeCategory, setActiveCategory] = useState<ExploreCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentTrips, setRecentTrips] = useState<SavedItinerary[]>([]);

  useEffect(() => {
    async function loadRecentTrips() {
      const token = getAccessToken();
      if (!token) return;
      try {
        const res = await apiFetchWithAuth(`${API_BASE_URL}/api/itinerary?limit=4`);
        if (res.ok) {
          const data = (await res.json()) as { itineraries?: SavedItinerary[] };
          setRecentTrips(data.itineraries || []);
        }
      } catch {
        // Not critical, silently fail
      }
    }
    void loadRecentTrips();
  }, []);

  const filteredPlaces = trendingPlaces.filter((place) => {
    const matchCategory = activeCategory === "all" || place.category === activeCategory;
    const matchSearch = !searchQuery
      || place.name.toLowerCase().includes(searchQuery.toLowerCase())
      || place.location.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={user ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border bg-surface px-8 pt-8 pb-0">
          <h1 className="text-page-title text-primary">Explore</h1>
          <p className="mt-1 text-sm text-muted">
            Discover incredible places and experiences around the world.
          </p>

          {/* Search */}
          <div className="mt-6 flex items-center gap-3">
            <div className="flex flex-1 items-center rounded-2xl border border-border bg-surface-muted px-4">
              <Search size={16} className="text-muted mr-2" />
              <input
                className="min-w-0 flex-1 bg-transparent py-3 text-sm text-primary placeholder:text-muted outline-none"
                placeholder="Search places, cities, or experiences..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      setSearchQuery(`${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`);
                    },
                    () => setSearchQuery("Taipei"),
                  );
                }
              }}
            >
              <MapPin size={14} className="mr-1.5" />
              Near me
            </Button>
          </div>

          {/* Category tabs */}
          <div className="mt-6">
            <Tabs
              items={categories}
              activeId={activeCategory}
              onChange={(id) => setActiveCategory(id as ExploreCategory)}
            />
          </div>
        </div>

        <div className="px-8 py-8">
          {/* Popular destinations */}
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-section-title text-primary">Popular destinations</h2>
              <button
                className="text-sm font-medium text-primary hover:underline"
                onClick={() => setActiveCategory("all")}
              >
                See all
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {popularDestinations.map((dest) => (
                <Link
                  key={dest.name}
                  href={`/explore?q=${encodeURIComponent(dest.name)}`}
                  className="group flex flex-col items-center rounded-card border border-border p-4 text-center hover:shadow-card-hover transition-shadow"
                >
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted">
                    <MapPin size={20} className="text-muted group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-sm font-medium text-primary">{dest.name}</p>
                  <p className="text-xs text-muted">{dest.count}</p>
                </Link>
              ))}
            </div>
          </section>

          {/* Recent trips */}
          {recentTrips.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-section-title text-primary">Your recent trips</h2>
                <button
                  className="text-sm font-medium text-primary hover:underline"
                  onClick={() => router.push("/saved")}
                >
                  View all
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {recentTrips.map((trip) => (
                  <Card
                    key={trip.id}
                    hoverable
                    className="cursor-pointer"
                    onClick={() => router.push(`/?itineraryId=${trip.id}`)}
                  >
                    <CardContent className="p-4">
                      <CardTitle className="text-sm">{trip.title || "Untitled trip"}</CardTitle>
                      <CardDescription>
                        <span className="flex items-center gap-1 mt-1">
                          <Calendar size={10} />
                          {trip.days_count || 0} days
                          {trip.status && ` / ${trip.status}`}
                        </span>
                      </CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Trending places */}
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={18} className="text-primary" />
                <h2 className="text-section-title text-primary">Trending places</h2>
              </div>
              <button
                className="text-sm font-medium text-primary hover:underline"
                onClick={() => { setActiveCategory("all"); setSearchQuery(""); }}
              >
                See all
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {filteredPlaces.map((place) => (
                <Card key={place.id} hoverable className="cursor-pointer" onClick={() => router.push(`/?destination=${encodeURIComponent(place.name)}`)}>
                  <CardImage>
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-muted to-surface-hover">
                      <Camera size={32} className="text-muted/30" />
                    </div>
                  </CardImage>
                  <CardContent>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle>{place.name}</CardTitle>
                        <CardDescription>
                          <MapPin size={10} className="mr-1 inline" />
                          {place.location}
                        </CardDescription>
                      </div>
                      <span className="flex items-center gap-0.5 text-xs font-medium text-primary">
                        <Star size={10} className="fill-accent text-accent" />
                        {place.rating}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Tag variant="outline">{place.category}</Tag>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {filteredPlaces.length === 0 && (
              <p className="py-12 text-center text-sm text-muted">
                No places found matching your criteria.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
