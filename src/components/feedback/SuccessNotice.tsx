interface SuccessNoticeProps {
  title: string;
  message: string;
}

export function SuccessNotice({ title, message }: SuccessNoticeProps) {
  return (
    <div className="rounded-3xl border border-raf-sage bg-raf-sage/60 px-5 py-4 text-sm text-raf-ink">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1">{message}</p>
    </div>
  );
}
