import { useState, useEffect, useCallback, useRef } from 'react';

const PAGE_SIZE = 60;

export default function useInfiniteScroll(items) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);

  // Reset when items change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [items]);

  const setSentinelRef = useCallback((node) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    if (node) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, items.length));
          }
        },
        { rootMargin: '200px' }
      );
      observerRef.current.observe(node);
    }

    sentinelRef.current = node;
  }, [items.length]);

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, []);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  return { visibleItems, hasMore, sentinelRef: setSentinelRef };
}
