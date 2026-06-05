export function Card() {
  const Header = memo(() => <h2 />);
  return <Header />;
}

export const Label = () => {
  const renderText = () => <span />;
  return renderText();
};
