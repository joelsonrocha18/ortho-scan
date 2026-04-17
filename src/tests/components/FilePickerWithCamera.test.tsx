import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import FilePickerWithCamera from '../../components/files/FilePickerWithCamera'

describe('FilePickerWithCamera', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0)', configurable: true })
  })

  it('keeps camera input with accept and capture attributes', () => {
    const { container } = render(<FilePickerWithCamera onFileSelected={() => undefined} capture="environment" />)
    const cameraInput = container.querySelector('input[capture="environment"]') as HTMLInputElement | null
    expect(cameraInput).toBeTruthy()
    expect(cameraInput?.getAttribute('accept')).toBe('image/*')
  })

  it('opens modal fallback on iPhone user agent', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'iPhone', configurable: true })
    render(<FilePickerWithCamera onFileSelected={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))
    expect(await screen.findByText('Capturar foto')).toBeInTheDocument()
  })

  it('calls onFileSelected on upload input', () => {
    const onFile = vi.fn()
    const { container } = render(<FilePickerWithCamera onFileSelected={onFile} />)
    const uploadInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement

    const file = new File(['abc'], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(uploadInput, { target: { files: [file] } })

    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(file)
  })
})
