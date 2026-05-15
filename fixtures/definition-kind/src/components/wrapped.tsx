export const StyledBox = styled.div`
  display: block;
`;

export const ConnectedMenu = connect(mapState)(MenuBase);

function TabsBase() {
  return null;
}

export const WrappedTabs = memo(TabsBase);
