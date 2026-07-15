/**
 * WellSim Frontend — useDeviceData Hook
 * 
 * Custom React hook that polls the backend every 2 seconds
 * and provides real-time device data + connection status.
 * 
 * Returns:
 *   - deviceData:  Latest sensor reading (or null)
 *   - deviceStatus: Connection status object (or null)
 *   - isLoading:   True on initial fetch
 *   - error:       Error message (or null)
 *   - lastUpdated: Timestamp of the last successful fetch
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchLatestData, fetchDeviceStatus } from '../services/api';

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

export function useDeviceData(deviceId) {
  const [deviceData, setDeviceData] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Track whether a data flash animation should play
  const [hasNewData, setHasNewData] = useState(false);
  const prevDataRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      // Fetch both latest data and status in parallel
      const [latestRes, statusRes] = await Promise.allSettled([
        fetchLatestData(deviceId),
        fetchDeviceStatus(deviceId),
      ]);

      // Process latest data
      if (latestRes.status === 'fulfilled' && latestRes.value.success) {
        const newData = latestRes.value.data;

        // Detect if data has actually changed (compare by _receivedAt timestamp)
        const currentTimestamp = Array.isArray(newData)
          ? newData[0]?._receivedAt
          : newData?._receivedAt;

        if (currentTimestamp !== prevDataRef.current) {
          setHasNewData(true);
          prevDataRef.current = currentTimestamp;
          // Reset flash after animation completes
          setTimeout(() => setHasNewData(false), 1000);
        }

        // If multiple devices, pick the first; otherwise use directly
        setDeviceData(Array.isArray(newData) ? newData[0] : newData);
      }

      // Process status
      if (statusRes.status === 'fulfilled' && statusRes.value.success) {
        const statusData = statusRes.value;
        // Handle both single device and array responses
        if (statusData.devices) {
          setDeviceStatus(statusData.devices[0] || null);
        } else {
          setDeviceStatus(statusData);
        }
      }

      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      // Only set error if we've never received data (don't flash errors during polling)
      if (!deviceData) {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [deviceId, deviceData]);

  // Set up polling interval
  useEffect(() => {
    // Initial fetch
    fetchData();

    // Start polling
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    deviceData,
    deviceStatus,
    isLoading,
    error,
    lastUpdated,
    hasNewData,
  };
}
