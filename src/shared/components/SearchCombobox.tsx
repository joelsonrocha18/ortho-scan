import { Check, Loader2, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Input from '../../components/Input'
import { cn } from '../../lib/cn'

type SearchComboboxProps<T> = {
  placeholder: string
  searchFn: (query: string) => Promise<T[]>
  renderItem: (item: T) => ReactNode
  onSelect: (item: T) => void
  debounceMs?: number
  minChars?: number
}

export default function SearchCombobox<T>({
  placeholder,
  searchFn,
  renderItem,
  onSelect,
  debounceMs = 250,
  minChars = 2,
}: SearchComboboxProps<T>) {
  const listId = useId()
  const requestId = useRef(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (query.trim().length < minChars) {
      setResults([])
      setOpen(false)
      return
    }

    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setLoading(true)
    const timeout = window.setTimeout(() => {
      searchFn(query.trim())
        .then((items) => {
          if (requestId.current !== currentRequest) return
          setResults(items)
          setActiveIndex(0)
          setOpen(true)
        })
        .finally(() => {
          if (requestId.current === currentRequest) setLoading(false)
        })
    }, debounceMs)

    return () => window.clearTimeout(timeout)
  }, [debounceMs, minChars, query, searchFn])

  function selectItem(item: T) {
    onSelect(item)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(event) => {
          if (!open) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((index) => Math.min(index + 1, results.length - 1))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((index) => Math.max(index - 1, 0))
          }
          if (event.key === 'Enter' && results[activeIndex]) {
            event.preventDefault()
            selectItem(results[activeIndex])
          }
          if (event.key === 'Escape') setOpen(false)
        }}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        className="pl-9"
      />
      {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}

      {open ? (
        <div id={listId} role="listbox" className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">Nenhum resultado encontrado.</div>
          ) : (
            results.map((item, index) => (
              <button
                key={index}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectItem(item)}
                className={cn('flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm', index === activeIndex ? 'bg-baby-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50')}
              >
                <span className="min-w-0 flex-1">{renderItem(item)}</span>
                {index === activeIndex ? <Check className="h-4 w-4" /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
