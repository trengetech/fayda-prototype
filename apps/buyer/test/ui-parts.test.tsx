import { ThemeProvider, AppBar, Chip, IconButton, ListRow, Segmented, TabBar, Button } from '@fayda/ui';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const wrap = async (ui: React.ReactElement) => render(<ThemeProvider scheme="light">{ui}</ThemeProvider>);

describe('shared UI parts', () => {
  it('tab bar marks the current tab, shows count dots, and reports a tap', async () => {
    const onSelect = jest.fn();
    await wrap(<TabBar current="offers" onSelect={onSelect} tabs={[{ key: 'home', label: 'Home', icon: 'home' }, { key: 'offers', label: 'Offers', icon: 'tag', count: 2 }]} />);
    expect(screen.getByLabelText('Offers, 2 new')).toBeSelected();
    expect(screen.getByLabelText('Home')).not.toBeSelected();
    fireEvent.press(screen.getByLabelText('Home'));
    expect(onSelect).toHaveBeenCalledWith('home');
  });

  it('shows no count dot for zero, and 99+ for large counts', async () => {
    await wrap(<><IconButton icon="bell" label="Alerts" count={0} /><IconButton icon="bell" label="Many" count={150} /></>);
    expect(screen.getByLabelText('Alerts')).toBeOnTheScreen();
    expect(screen.queryByText('0', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('app bar back button, chip, segmented control and list row all fire their press', async () => {
    const back = jest.fn(), chip = jest.fn(), seg = jest.fn(), row = jest.fn();
    await wrap(<><AppBar title="Orders" onBack={back} /><Chip label="Ethnic" onPress={chip} /><Segmented value="a" onChange={seg} options={[{ key: 'a', label: 'For you' }, { key: 'b', label: 'Following' }]} /><ListRow title="Saved" icon="bookmark" onPress={row} /></>);
    await act(async () => { fireEvent.press(screen.getByLabelText('Back')); fireEvent.press(screen.getByText('Ethnic')); fireEvent.press(screen.getByText('Following')); fireEvent.press(screen.getByLabelText('Saved')); });
    expect([back, chip, seg, row].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
    expect(seg).toHaveBeenCalledWith('b');
  });

  it('a button with an icon still shows its text and is pressable', async () => {
    const onPress = jest.fn();
    await wrap(<Button title="New listing" icon="plus" onPress={onPress} />);
    fireEvent.press(screen.getByText('New listing'));
    expect(onPress).toHaveBeenCalled();
  });
});
