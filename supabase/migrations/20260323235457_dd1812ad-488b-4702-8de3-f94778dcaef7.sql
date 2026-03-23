-- Allow users to delete their own redemptions (for cancel restoration)
CREATE POLICY "Users can delete their own redemptions"
  ON public.free_meal_redemptions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Allow users to update their own audit entries (for cancel restoration) 
CREATE POLICY "Users can update own free meal audit"
  ON public.free_meal_audit FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow admin to delete audit entries
CREATE POLICY "Admin can delete free meal audit"
  ON public.free_meal_audit FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Allow admin to delete redemptions
CREATE POLICY "Admin can delete redemptions"
  ON public.free_meal_redemptions FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));