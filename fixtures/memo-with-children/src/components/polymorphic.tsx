type PolymorphicProps = { children: ReactNode };

const PolymorphicBase = forwardRef(({ children }, ref) => null) as ForwardRefComponent<
  "li",
  PolymorphicProps
>;

export const Polymorphic = memo(PolymorphicBase) as MemoComponent<"li", PolymorphicProps>;

type MappedProps = Override<HTMLAttributes, { children: ReactNode }>;

export const Mapped = memo(({ children }: MappedProps) => null);

type OpaqueProps = Override<HTMLAttributes, { children: ReactNode }>;

export const Opaque = memo((props: OpaqueProps) => null);
