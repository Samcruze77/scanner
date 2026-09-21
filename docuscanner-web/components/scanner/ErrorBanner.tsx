import { Icon } from "@/components/ui/icons";

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div role="alert" className="notice notice-error">
      {/* The icon means an error notice never relies on its colour alone. */}
      <Icon name="alert" size={18} className="mt-0.5" />
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
