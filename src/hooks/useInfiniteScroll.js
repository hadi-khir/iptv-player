import { useState, useEffect, useRef, useCallback } from 'react';

const PAGE_SIZE = 60;

export default function useInfiniteScroll(items) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollRef = useRef(null);

  // Reset when the underlying list changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [items]);

  const onScroll = useCallback((e) => {
    const el = e.target;
    // Load more when scrolled within 300px of the bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      setVisibleCount((prev) => {
        const next = prev + PAGE_SIZE;
        return next > items.length ? items.length : next;
      });
    }
  }, [items.length]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  return { visibleItems, hasMore, scrollRef, onScroll };
}
