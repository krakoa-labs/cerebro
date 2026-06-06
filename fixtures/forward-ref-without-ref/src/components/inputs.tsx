export const Used = forwardRef((props, ref) => <input ref={ref} />);

export const Dropped = forwardRef((props, ref) => <input />);

export const NoRefParam = forwardRef((props) => <input />);
