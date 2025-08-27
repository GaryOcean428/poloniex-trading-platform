import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ToastContainer from '../../components/ToastContainer';
import { useAppStore } from '../../store';

// Mock the store
const mockToasts = [
  {
    id: '1',
    message: 'Test toast message',
    type: 'info',
    dismissible: true
  },
  {
    id: '2', 
    message: 'Success message',
    type: 'success',
    dismissible: false
  }
];

const mockRemoveToast = vi.fn();

// Mock zustand store
vi.mock('../../store', () => ({
  useAppStore: vi.fn()
}));

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAppStore as any).mockImplementation((selector: any) => {
      const state = {
        toasts: mockToasts,
        removeToast: mockRemoveToast
      };
      return selector(state);
    });
  });

  it('should render toasts in the top-right corner', () => {
    const { container } = render(<ToastContainer />);
    
    // Check that the container has the correct positioning classes
    const toastContainer = container.querySelector('.fixed');
    expect(toastContainer).toHaveClass('top-20', 'right-4', 'z-30');
    expect(toastContainer).not.toHaveClass('left-4');
  });

  it('should not block hamburger menu area', () => {
    const { container } = render(<ToastContainer />);
    
    // Verify positioning doesn't conflict with top-left area where hamburger menu is located
    const toastContainer = container.querySelector('.fixed');
    expect(toastContainer).toHaveClass('right-4');
    expect(toastContainer).not.toHaveClass('left-4');
  });

  it('should render toast messages correctly', () => {
    render(<ToastContainer />);
    
    expect(screen.getAllByText('Test toast message').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Success message').length).toBeGreaterThan(0);
  });

  it('should not render when no toasts are present', () => {
    (useAppStore as any).mockImplementation((selector: any) => {
      const state = {
        toasts: [],
        removeToast: mockRemoveToast
      };
      return selector(state);
    });

    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });
});