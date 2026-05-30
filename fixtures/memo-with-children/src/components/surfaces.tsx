interface CardProps {
  children: ReactNode;
  title: string;
}

export const Card = memo((props: CardProps) => null);

interface PanelProps {
  children: ReactNode;
}

export const Panel = memo<PanelProps>((props) => null);

interface BoxProps {
  children: ReactNode;
}

export const Box = memo(forwardRef<HTMLDivElement, BoxProps>((props, ref) => null));

export const Plain = (props: CardProps) => null;

export const Cached = memo((props: CardProps) => null, (prev, next) => prev.title === next.title);
