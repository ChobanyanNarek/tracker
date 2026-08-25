import { useEffect, useState } from 'react'

export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))

  // Reset to page 1 whenever the underlying result set changes size (new
  // search/filter) so the user never lands on a page that no longer exists.
  useEffect(() => { setPage(1) }, [items.length])

  const clampedPage = Math.min(page, totalPages)
  const start = (clampedPage - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)

  return { pageItems, page: clampedPage, setPage, totalPages }
}
