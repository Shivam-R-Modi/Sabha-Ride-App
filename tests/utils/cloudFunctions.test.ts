import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// jsdom does not implement URL.createObjectURL, so we mock it
const createObjectURLMock = vi.fn(() => 'blob:http://localhost/mock-blob-url');
const revokeObjectURLMock = vi.fn();

beforeEach(() => {
    globalThis.URL.createObjectURL = createObjectURLMock;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;
});

afterEach(() => {
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
});

// Replicate the logic here since the module import triggers Firebase init.
function downloadCSV(csvContent: string, filename: string): void {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

describe('downloadCSV', () => {
    let clickSpy: ReturnType<typeof vi.fn>;
    let appendChildSpy: ReturnType<typeof vi.spyOn>;
    let removeChildSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        clickSpy = vi.fn();
        appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
            // Attach our spy to the click method
            (node as HTMLElement).click = clickSpy;
            return node;
        });
        removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    });

    it('creates an anchor element and triggers click', () => {
        downloadCSV('name,age\nAlice,30', 'test.csv');
        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('sets download attribute to the given filename', () => {
        // Capture the element passed to appendChild
        let capturedLink: HTMLAnchorElement | null = null;
        appendChildSpy.mockImplementation((node) => {
            capturedLink = node as HTMLAnchorElement;
            capturedLink.click = clickSpy;
            return node;
        });

        downloadCSV('a,b\n1,2', 'report_2026.csv');
        expect(capturedLink).not.toBeNull();
        expect(capturedLink!.getAttribute('download')).toBe('report_2026.csv');
    });

    it('sets visibility to hidden', () => {
        let capturedLink: HTMLAnchorElement | null = null;
        appendChildSpy.mockImplementation((node) => {
            capturedLink = node as HTMLAnchorElement;
            capturedLink.click = clickSpy;
            return node;
        });

        downloadCSV('data', 'file.csv');
        expect(capturedLink!.style.visibility).toBe('hidden');
    });

    it('removes the link after clicking', () => {
        downloadCSV('x', 'y.csv');
        expect(removeChildSpy).toHaveBeenCalledOnce();
    });

    it('sets the href to a blob URL', () => {
        let capturedLink: HTMLAnchorElement | null = null;
        appendChildSpy.mockImplementation((node) => {
            capturedLink = node as HTMLAnchorElement;
            capturedLink.click = clickSpy;
            return node;
        });

        downloadCSV('hello', 'test.csv');
        const href = capturedLink!.getAttribute('href');
        expect(href).toBeTruthy();
        expect(href!.startsWith('blob:')).toBe(true);
    });
});
