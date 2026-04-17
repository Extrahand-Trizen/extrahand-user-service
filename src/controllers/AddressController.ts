import { Response } from 'express';
import { AuthenticatedRequest, SavedAddress } from '../types';
import { ProfileService } from '../services/ProfileService';
import logger from '../config/logger';
import mongoose from 'mongoose';
import { AppError } from '../errors/AppError';

export class AddressController {
  private static handleAddressError(error: any, res: Response, action: string): void {
    logger.error(`Error ${action}:`, error);

    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: error?.message || `Failed to ${action}`,
    });
  }

  // GET /api/v1/profiles/me/addresses
  static async getAddresses(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const profile = await ProfileService.getProfileByUid(uid);
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      // Return saved addresses or empty array
      const addresses = profile.savedAddresses || [];

      res.status(200).json({
        success: true,
        data: addresses
      });
    } catch (error: any) {
      this.handleAddressError(error, res, 'getting addresses');
    }
  }

  // POST /api/v1/profiles/me/addresses
  static async addAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const addressData: Partial<SavedAddress> = req.body;

      // Validate required fields
      if (!addressData.label || !addressData.address || !addressData.coordinates) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: label, address, coordinates'
        });
        return;
      }

      const profile = await ProfileService.getProfileByUid(uid);
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      // Create new address with MongoDB ObjectId
      const newAddress: SavedAddress = {
        _id: new mongoose.Types.ObjectId().toString(),
        label: addressData.label,
        address: addressData.address,
        coordinates: addressData.coordinates,
        city: addressData.city,
        state: addressData.state,
        country: addressData.country || 'India',
        addressDetails: addressData.addressDetails,
        name: addressData.name,
        phone: addressData.phone,
        isDefault: addressData.isDefault || false,
        createdAt: new Date()
      };

      // Get current addresses
      const currentAddresses = profile.savedAddresses || [];

      // If this is set as default, unset other defaults
      if (newAddress.isDefault) {
        currentAddresses.forEach(addr => {
          addr.isDefault = false;
        });
      }

      // Check if an address with the same label already exists
      const existingIndex = currentAddresses.findIndex(
        addr => addr.label?.toLowerCase() === newAddress.label?.toLowerCase()
      );

      let updatedAddresses: typeof currentAddresses;
      if (existingIndex !== -1) {
        // Update existing address with the same label instead of adding a duplicate
        currentAddresses[existingIndex] = {
          ...currentAddresses[existingIndex],
          ...newAddress,
          _id: currentAddresses[existingIndex]._id, // Preserve the original ID
        };
        updatedAddresses = [...currentAddresses];
      } else {
        // Add new address
        updatedAddresses = [...currentAddresses, newAddress];
      }

      // Update profile
      await ProfileService.updateProfile(uid, {
        savedAddresses: updatedAddresses
      });

      const savedAddress = existingIndex !== -1
        ? updatedAddresses[existingIndex]
        : newAddress;
      const statusCode = existingIndex !== -1 ? 200 : 201;
      const message = existingIndex !== -1 ? 'Address updated successfully' : 'Address added successfully';

      res.status(statusCode).json({
        success: true,
        data: savedAddress,
        message
      });
    } catch (error: any) {
      this.handleAddressError(error, res, 'adding address');
    }
  }

  // PUT /api/v1/profiles/me/addresses/:addressId
  static async updateAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user?.uid;
      const addressId = req.params.addressId;

      if (!uid) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const addressData: Partial<SavedAddress> = req.body;

      const profile = await ProfileService.getProfileByUid(uid);
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      const currentAddresses = profile.savedAddresses || [];
      const addressIndex = currentAddresses.findIndex(
        addr => addr._id?.toString() === addressId
      );

      if (addressIndex === -1) {
        res.status(404).json({ success: false, error: 'Address not found' });
        return;
      }

      // Update the address
      const updatedAddress = {
        ...currentAddresses[addressIndex],
        ...addressData,
        _id: addressId, // Preserve the ID
      };

      // If this is set as default, unset other defaults
      if (updatedAddress.isDefault) {
        currentAddresses.forEach((addr, idx) => {
          if (idx !== addressIndex) {
            addr.isDefault = false;
          }
        });
      }

      currentAddresses[addressIndex] = updatedAddress;

      // Update profile
      await ProfileService.updateProfile(uid, {
        savedAddresses: currentAddresses
      });

      res.status(200).json({
        success: true,
        data: updatedAddress,
        message: 'Address updated successfully'
      });
    } catch (error: any) {
      this.handleAddressError(error, res, 'updating address');
    }
  }

  // DELETE /api/v1/profiles/me/addresses/:addressId
  static async deleteAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user?.uid;
      const addressId = req.params.addressId;

      if (!uid) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const profile = await ProfileService.getProfileByUid(uid);
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      const currentAddresses = profile.savedAddresses || [];
      const filteredAddresses = currentAddresses.filter(
        addr => addr._id?.toString() !== addressId
      );

      if (filteredAddresses.length === currentAddresses.length) {
        res.status(404).json({ success: false, error: 'Address not found' });
        return;
      }

      // Update profile
      await ProfileService.updateProfile(uid, {
        savedAddresses: filteredAddresses
      });

      res.status(200).json({
        success: true,
        message: 'Address deleted successfully'
      });
    } catch (error: any) {
      this.handleAddressError(error, res, 'deleting address');
    }
  }

  // PATCH /api/v1/profiles/me/addresses/:addressId/default
  static async setDefaultAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user?.uid;
      const addressId = req.params.addressId;

      if (!uid) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const profile = await ProfileService.getProfileByUid(uid);
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      const currentAddresses = profile.savedAddresses || [];
      const addressIndex = currentAddresses.findIndex(
        addr => addr._id?.toString() === addressId
      );

      if (addressIndex === -1) {
        res.status(404).json({ success: false, error: 'Address not found' });
        return;
      }

      // Unset all defaults and set the specified one
      currentAddresses.forEach((addr, idx) => {
        addr.isDefault = idx === addressIndex;
      });

      // Update profile
      await ProfileService.updateProfile(uid, {
        savedAddresses: currentAddresses
      });

      res.status(200).json({
        success: true,
        data: currentAddresses[addressIndex],
        message: 'Default address updated successfully'
      });
    } catch (error: any) {
      this.handleAddressError(error, res, 'setting default address');
    }
  }
}
