export const MemoWrapped = memo(forwardRef((props, ref) => <div />));

export const Imperative = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => ({}));
  return <div />;
});

export const Plain = (props) => <div />;
