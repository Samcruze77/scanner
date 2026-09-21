import { Icon } from "@/components/ui/icons";

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="notice notice-error"
    >
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="btn btn-icon btn-ghost -my-2 -mr-2 shrink-0"
        >
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}
