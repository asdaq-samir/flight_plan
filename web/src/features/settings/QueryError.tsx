import { Button } from "../../components/ui/button";

export default function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}
