const TypingIndicator = () => {
  return (
    <div className="mt-8 flex items-center gap-0">
      <span className="typing-cursor text-typing-cursor font-mono text-lg leading-none">|</span>
      <div className="relative h-px flex-1 ml-1 overflow-hidden">
        <div className="typing-line absolute inset-y-0 left-0 bg-accent/40 h-full" />
      </div>
    </div>
  );
};

export default TypingIndicator;
