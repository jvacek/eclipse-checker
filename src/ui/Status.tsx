interface StatusProps {
  message: string;
  tone?: 'info' | 'error';
}

export function Status({ message, tone = 'info' }: StatusProps) {
  return (
    <p
      className={`message${tone === 'error' ? ' error' : ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}
