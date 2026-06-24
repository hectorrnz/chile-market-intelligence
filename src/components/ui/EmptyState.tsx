export function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-xs text-muted-fg">{message}</p>
    </div>
  )
}
